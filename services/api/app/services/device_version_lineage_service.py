"""Persisted device version timeline (§13 / §15) + KPI snapshots."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_version_lineage import DeviceVersionLineage
from app.schemas.device import VersionLineageResponse, VersionLineageVersionItem

log = logging.getLogger(__name__)


def bump_device_version_monotonic_label(label: str) -> str:
    """Next label when the platform auto-mints a version (numeric or trailing numeric segment)."""
    s = (label or "").strip() or "1"
    if s.isdigit():
        return str(int(s, 10) + 1)
    m = re.search(r"^(.*?)(\d+)$", s)
    if m:
        prefix, num = m.group(1), m.group(2)
        return f"{prefix}{int(num, 10) + 1}"
    return f"{s}-2"


def kpi_snapshot_from_footprint_dict(fp: dict[str, Any]) -> dict[str, Any]:
    ing = fp.get("ingestion") or {}
    dash = fp.get("dashboard") or {}
    ep = fp.get("endpoint") or {}
    scrub = fp.get("scrubber") or {}
    return {
        "footprint_status": fp.get("status"),
        "ingestion.last_ingested_at": ing.get("last_ingested_at"),
        "ingestion.ingest_age_sec": ing.get("ingest_age_sec"),
        "dashboard.count": dash.get("count"),
        "endpoint.status": ep.get("status"),
        "scrubber.associated": scrub.get("associated"),
        "scrubber.status": scrub.get("status"),
    }


def _lineage_metadata_from_device(device: Device) -> dict[str, Any]:
    return {
        "version_status": device.version_status,
        "firmware_version": device.firmware_version,
        "firmware_channel": device.firmware_channel,
        "ota_supported": device.ota_supported,
        "rollback_supported": device.rollback_supported,
    }


def ensure_bootstrap_lineage_row(db: Session, device: Device, *, fp: dict[str, Any] | None = None) -> None:
    """If no lineage rows exist for this device, insert bootstrap (post-migration devices).

    Commits internally so the row persists on read/bootstrap paths; see DEVICE_VERSIONING_SPEC.md §15.1.
    Prefer caller-owned commits for new call sites once lineage rollout hardens.
    """
    exists_id = db.scalar(select(DeviceVersionLineage.id).where(DeviceVersionLineage.device_id == device.id).limit(1))
    if exists_id:
        return
    vlabel = (device.device_version or "").strip() or "1"
    recorded = device.updated_at or device.created_at
    kpi = kpi_snapshot_from_footprint_dict(fp) if fp else None
    row = DeviceVersionLineage(
        id=uuid.uuid4(),
        device_id=device.id,
        version_label=vlabel,
        recorded_at=recorded,
        trigger_code="bootstrap",
        superseded_by_label=None,
        ota_external_ref=None,
        kpi_snapshot=kpi,
        metadata_=_lineage_metadata_from_device(device),
    )
    db.add(row)
    db.commit()
    log.info("device_version_lineage bootstrap inserted device_id=%s", device.id)


def record_version_lineage_transition(
    db: Session,
    device: Device,
    *,
    previous_label: str,
    new_label: str,
    trigger_code: str,
    kpi_snapshot: dict[str, Any] | None,
    ota_external_ref: str | None = None,
) -> None:
    """Mark prior head row superseded and append a new lineage row (§13 / §15)."""
    if previous_label == new_label:
        return
    now = datetime.now(timezone.utc)
    last = db.execute(
        select(DeviceVersionLineage)
        .where(DeviceVersionLineage.device_id == device.id)
        .order_by(DeviceVersionLineage.recorded_at.desc(), DeviceVersionLineage.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if last and last.superseded_by_label is None and last.version_label != new_label:
        last.superseded_by_label = new_label
        db.add(last)
    meta = _lineage_metadata_from_device(device)
    db.add(
        DeviceVersionLineage(
            id=uuid.uuid4(),
            device_id=device.id,
            version_label=new_label,
            recorded_at=now,
            trigger_code=trigger_code,
            superseded_by_label=None,
            ota_external_ref=(ota_external_ref.strip()[:255] if ota_external_ref and ota_external_ref.strip() else None),
            kpi_snapshot=kpi_snapshot,
            metadata_=meta,
        )
    )
    db.flush()
    log.info(
        "device_version_lineage trigger=%s device_id=%s %s -> %s",
        trigger_code,
        device.id,
        previous_label,
        new_label,
    )


def record_explicit_version_change(
    db: Session,
    device: Device,
    *,
    previous_label: str,
    new_label: str,
    kpi_snapshot: dict[str, Any] | None,
) -> None:
    """Mark prior head row superseded and append a new lineage entry (explicit version / PATCH)."""
    record_version_lineage_transition(
        db,
        device,
        previous_label=previous_label,
        new_label=new_label,
        trigger_code="explicit",
        kpi_snapshot=kpi_snapshot,
        ota_external_ref=None,
    )


def build_version_lineage_response(db: Session, device: Device, fp: dict[str, Any]) -> VersionLineageResponse:
    ensure_bootstrap_lineage_row(db, device, fp=fp)

    rows = list(
        db.scalars(
            select(DeviceVersionLineage)
            .where(DeviceVersionLineage.device_id == device.id)
            .order_by(DeviceVersionLineage.recorded_at.asc(), DeviceVersionLineage.id.asc())
        ).all()
    )

    cur_label = (device.device_version or "").strip() or "1"
    live_kpi = kpi_snapshot_from_footprint_dict(fp)

    versions: list[VersionLineageVersionItem] = []
    kpi_by_version: dict[str, dict[str, Any]] = {}
    all_keys: set[str] = set()

    for i, r in enumerate(rows):
        is_current = (i == len(rows) - 1) and (r.version_label == cur_label)
        snap = dict(r.kpi_snapshot) if r.kpi_snapshot else {}
        if is_current:
            snap = {**snap, **live_kpi}
        for k in snap:
            all_keys.add(k)
        kpi_by_version[r.version_label] = snap
        meta = dict(r.metadata_ or {})
        versions.append(
            VersionLineageVersionItem(
                id=str(r.id),
                version_label=r.version_label,
                is_current=is_current,
                recorded_at=r.recorded_at,
                trigger_code=r.trigger_code,
                superseded_by_label=r.superseded_by_label,
                ota_external_ref=r.ota_external_ref,
                metadata=meta,
            )
        )

    if not all_keys:
        all_keys = set(live_kpi.keys())

    return VersionLineageResponse(
        device_id=str(device.id),
        versions=versions,
        kpi_metric_keys=sorted(all_keys),
        kpi_by_version=kpi_by_version,
    )
