"""Copy-forward activation artifacts (endpoint / scrubber / workflows / dashboards) + apply on promote."""

from __future__ import annotations

import copy
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_object import DeviceObject
from app.models.device_version import DeviceVersion
from app.models.endpoint import Endpoint
from app.models.user import User
from app.services.device_operational_footprint_service import (
    batch_dashboard_references,
    batch_load_footprint_sidecars,
    ingest_contract_fingerprint,
    workflows_for_device,
)
from app.services.permission_service import ensure_site_permission

log = logging.getLogger(__name__)

_ARTIFACT_KEYS = ("endpoint", "scrubber", "workflows", "dashboards")


def _load_dv_device(db: Session, user: User, device_version_id: uuid.UUID) -> tuple[DeviceVersion, Device]:
    dv = db.get(DeviceVersion, device_version_id)
    if not dv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device version not found")
    device = db.get(Device, dv.device_id)
    if not device or device.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device version not found")
    return dv, device


def _resolve_baseline_version(
    db: Session, *, device: Device, from_id: uuid.UUID | None
) -> DeviceVersion | None:
    if from_id is not None:
        b = db.get(DeviceVersion, from_id)
        if not b or b.device_id != device.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "from_device_version_id is not for this device.")
        return b
    return db.scalars(
        select(DeviceVersion)
        .where(
            DeviceVersion.device_id == device.id,
            DeviceVersion.routing_lane == "shared",
            DeviceVersion.status == "active",
        )
        .order_by(DeviceVersion.activated_at.desc().nulls_last(), DeviceVersion.created_at.desc())
        .limit(1)
    ).first()


def copy_forward_activation_artifacts(
    db: Session,
    user: User,
    device_version_id: uuid.UUID,
    *,
    from_device_version_id: uuid.UUID | None = None,
) -> DeviceVersion:
    """Stage copies of operational artifacts onto a draft cut for governance review."""
    dv, device = _load_dv_device(db, user, device_version_id)
    ensure_site_permission(db, user, device.site_id, "device_versions.promote")
    if dv.status != "draft":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Copy-forward is only available for versions in draft (after Review).",
        )
    baseline = _resolve_baseline_version(db, device=device, from_id=from_device_version_id)
    ep_by_de, dobjs = batch_load_footprint_sidecars(db, [device])
    ep_row = ep_by_de.get(device.endpoint.id) if device.endpoint else None
    dobj = dobjs.get(device.id)

    endpoint_snap: dict[str, Any] = {}
    if ep_row:
        endpoint_snap = {
            "endpoint_id": str(ep_row.id),
            "endpoint_name": ep_row.endpoint_name,
            "version_identity": ep_row.version_identity if isinstance(ep_row.version_identity, dict) else None,
            "primary_device_key_fields": ep_row.primary_device_key_fields,
            "device_label_fields": ep_row.device_label_fields,
            "lifecycle_status": ep_row.lifecycle_status,
        }

    scrub_snap: dict[str, Any] = {}
    if dobj and isinstance(dobj.mapping, dict):
        scrub_snap = {"mapping": copy.deepcopy(dobj.mapping)}

    wf_items = workflows_for_device(db, customer_id=device.customer_id, device=device, ep_by_de=ep_by_de)
    dash_rows = batch_dashboard_references(db, customer_id=device.customer_id, device_ids={device.id}).get(
        device.id, []
    )
    dash_items = [
        {
            "dashboard_id": str(r.get("id") or r.get("dashboard_id") or ""),
            "name": r.get("name"),
            "status": r.get("status"),
        }
        for r in dash_rows
        if (r.get("id") or r.get("dashboard_id"))
    ]

    now = datetime.now(timezone.utc).isoformat()
    bundle: dict[str, Any] = {
        "copy_staged_at": now,
        "copied_from_device_version_id": str(baseline.id) if baseline else None,
        "endpoint": {"status": "draft", "snapshot": endpoint_snap},
        "scrubber": {"status": "draft", "snapshot": scrub_snap},
        "workflows": {"status": "draft", "items": wf_items},
        "dashboards": {"status": "draft", "items": dash_items},
    }
    dv.activation_artifacts_json = bundle
    db.add(dv)
    db.flush()
    log.info("activation copy-forward staged device_version_id=%s device_id=%s", dv.id, device.id)
    return dv


def accept_activation_artifacts(
    db: Session,
    user: User,
    device_version_id: uuid.UUID,
    *,
    kinds: list[str] | None,
) -> DeviceVersion:
    """Mark staged artifact groups accepted (all, or a subset)."""
    dv, device = _load_dv_device(db, user, device_version_id)
    ensure_site_permission(db, user, device.site_id, "device_versions.promote")
    if dv.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Acceptance applies only to draft versions.")
    art = dv.activation_artifacts_json
    if not isinstance(art, dict) or not art.get("copy_staged_at"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Run copy-forward first to stage activation artifacts.",
        )
    want = kinds or ["all"]
    if "all" in {str(x).strip().lower() for x in want}:
        targets = list(_ARTIFACT_KEYS)
    else:
        targets = [str(k).strip().lower() for k in want if str(k).strip()]
        for k in targets:
            if k not in _ARTIFACT_KEYS:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown artifact kind: {k}")
    for k in targets:
        sec = art.get(k)
        if isinstance(sec, dict):
            sec["status"] = "accepted"
            art[k] = sec
    dv.activation_artifacts_json = art
    db.add(dv)
    db.flush()
    return dv


def activation_artifacts_gate_or_raise(dv: DeviceVersion) -> None:
    """When a staged bundle exists, every group must be accepted before promote."""
    art = dv.activation_artifacts_json
    if not isinstance(art, dict) or not art.get("copy_staged_at"):
        return
    missing: list[str] = []
    for k in _ARTIFACT_KEYS:
        sec = art.get(k)
        if not isinstance(sec, dict) or sec.get("status") != "accepted":
            missing.append(k)
    if missing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Accept all staged activation groups before activating: " + ", ".join(missing),
        )


def apply_accepted_activation_to_live(db: Session, device: Device, dv: DeviceVersion) -> None:
    """Apply accepted scrubber snapshot to ``device_objects.mapping`` (operational default reads)."""
    art = dv.activation_artifacts_json
    if not isinstance(art, dict):
        return
    sub = art.get("scrubber")
    if not isinstance(sub, dict) or sub.get("status") != "accepted":
        return
    snap = sub.get("snapshot")
    if not isinstance(snap, dict):
        return
    dobj = db.scalar(select(DeviceObject).where(DeviceObject.device_id == device.id).limit(1))
    if not dobj:
        log.warning("apply_activation: no device_object for device_id=%s", device.id)
        return
    mapping = dict(dobj.mapping) if isinstance(dobj.mapping, dict) else {}
    inner = snap.get("mapping")
    if isinstance(inner, dict) and isinstance(inner.get("scrubberStudio"), dict):
        ss = copy.deepcopy(inner["scrubberStudio"])
        prev_ss = mapping.get("scrubberStudio") if isinstance(mapping.get("scrubberStudio"), dict) else {}
        mapping["scrubberStudio"] = {**prev_ss, **ss} if isinstance(prev_ss, dict) else ss
    elif isinstance(snap.get("scrubberStudio"), dict):
        prev_ss = mapping.get("scrubberStudio") if isinstance(mapping.get("scrubberStudio"), dict) else {}
        mapping["scrubberStudio"] = {**prev_ss, **copy.deepcopy(snap["scrubberStudio"])}
    dobj.mapping = mapping
    db.add(dobj)
    db.flush()
    log.info("activation applied scrubber snapshot device_id=%s device_version_id=%s", device.id, dv.id)


def record_frozen_operational_summary(db: Session, device: Device, dv: DeviceVersion) -> None:
    """Persist a compact fingerprint of live operational bindings at activation time."""
    ep_by_de, dobjs = batch_load_footprint_sidecars(db, [device])
    dobj = dobjs.get(device.id)
    fp = ingest_contract_fingerprint(dobj.mapping if dobj and isinstance(dobj.mapping, dict) else {})
    ep_row = ep_by_de.get(device.endpoint.id) if device.endpoint else None
    wf_items = workflows_for_device(db, customer_id=device.customer_id, device=device, ep_by_de=ep_by_de)
    dash_rows = batch_dashboard_references(db, customer_id=device.customer_id, device_ids={device.id}).get(
        device.id, []
    )
    dv.frozen_operational_summary_json = {
        "activated_at": datetime.now(timezone.utc).isoformat(),
        "ingest_contract_fingerprint": fp,
        "endpoint_id": str(ep_row.id) if ep_row else None,
        "workflow_ids": [x.get("id") for x in wf_items if x.get("id")],
        "dashboard_ids": [str(r.get("id") or r.get("dashboard_id")) for r in dash_rows if (r.get("id") or r.get("dashboard_id"))],
    }
    db.add(dv)
    db.flush()
