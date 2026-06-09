"""Promote / isolate / rollback for immutable device_versions (Phase 6)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_version import DeviceVersion
from app.models.user import User
from app.services.device_version_lineage_service import append_lineage_event
from app.services.device_version_operational_service import active_operational_device_version
from app.services.permission_service import ensure_site_permission
from app.services.routing_policy import CANDIDATE_LANE, SHARED_LANE

log = logging.getLogger(__name__)


def _emit_version_audit(
    db: Session,
    user: User,
    device: Device,
    action_type: str,
    device_version_id: uuid.UUID,
    payload_json: dict | None = None,
) -> None:
    from app.services.control_plane_audit_service import emit_control_plane_audit

    emit_control_plane_audit(
        db,
        customer_id=device.customer_id,
        site_id=device.site_id,
        actor_user_id=user.id,
        action_type=action_type,
        resource_type="device_version",
        resource_id=device_version_id,
        payload_json=payload_json,
    )


def _load_device_version_for_user(
    db: Session, user: User, device_version_id: uuid.UUID
) -> tuple[DeviceVersion, Device]:
    dv = db.get(DeviceVersion, device_version_id)
    if not dv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device version not found")
    device = db.get(Device, dv.device_id)
    if not device or device.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device version not found")
    return dv, device


def promote_device_version(db: Session, user: User, device_version_id: uuid.UUID) -> DeviceVersion:
    dv, device = _load_device_version_for_user(db, user, device_version_id)
    ensure_site_permission(db, user, device.site_id, "device_versions.promote")
    now = datetime.now(timezone.utc)
    if dv.status == "detected":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Submit this detected version for review (draft) before activating it in production.",
        )
    if dv.status not in ("draft", "active", "isolated"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Cannot promote from status {dv.status!r}.",
        )
    from app.services.device_version_activation_service import (
        activation_artifacts_gate_or_raise,
        apply_accepted_activation_to_live,
        record_frozen_operational_summary,
    )

    activation_artifacts_gate_or_raise(dv)
    if dv.status == "draft" and dv.previous_device_version_id is None:
        prev_active = db.scalar(
            select(DeviceVersion.id)
            .where(
                DeviceVersion.device_id == device.id,
                DeviceVersion.id != dv.id,
                DeviceVersion.routing_lane == SHARED_LANE,
                DeviceVersion.status == "active",
            )
            .order_by(DeviceVersion.activated_at.desc().nulls_last(), DeviceVersion.created_at.desc())
            .limit(1)
        )
        if prev_active is not None:
            dv.previous_device_version_id = prev_active
            db.add(dv)
    others = list(
        db.scalars(
            select(DeviceVersion).where(
                DeviceVersion.device_id == device.id,
                DeviceVersion.id != dv.id,
                DeviceVersion.routing_lane == SHARED_LANE,
                DeviceVersion.status == "active",
            )
        ).all()
    )
    for o in others:
        o.status = "deprecated"
        o.deprecated_at = now
        db.add(o)
    dv.status = "active"
    dv.routing_lane = SHARED_LANE
    dv.activated_at = dv.activated_at or now
    db.add(dv)
    device.device_version = dv.resolved_display_label()
    db.add(device)
    append_lineage_event(
        db,
        device,
        version_label=dv.resolved_display_label(),
        trigger_code="version_promoted",
        event_type="version_promoted",
        source_type="api",
        status="completed",
        payload_json={"device_version_id": str(dv.id)},
        created_by=user.id,
        ota_campaign_id=None,
        ota_external_ref=None,
        target_device_version_id=dv.id,
        previous_device_version_id=dv.previous_device_version_id,
    )
    db.flush()
    _emit_version_audit(
        db,
        user,
        device,
        "version_promoted",
        dv.id,
        {"version_label": dv.version_label, "display_version_label": dv.resolved_display_label()},
    )
    apply_accepted_activation_to_live(db, device, dv)
    record_frozen_operational_summary(db, device, dv)
    log.info("device_version promoted id=%s device_id=%s", dv.id, device.id)
    return dv


def submit_device_version_draft(db: Session, user: User, device_version_id: uuid.UUID) -> DeviceVersion:
    """Governance: ``detected`` (async identity cut) → ``draft`` for operator review."""
    dv, device = _load_device_version_for_user(db, user, device_version_id)
    ensure_site_permission(db, user, device.site_id, "device_versions.promote")
    if dv.status != "detected":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only versions in detected state can be submitted for review.",
        )
    dv.status = "draft"
    db.add(dv)
    append_lineage_event(
        db,
        device,
        version_label=dv.resolved_display_label(),
        trigger_code="version_identity_review",
        event_type="version_draft_submitted",
        source_type="api",
        status="completed",
        payload_json={"device_version_id": str(dv.id)},
        created_by=user.id,
        ota_campaign_id=None,
        ota_external_ref=None,
        target_device_version_id=dv.id,
        previous_device_version_id=dv.previous_device_version_id,
    )
    db.flush()
    _emit_version_audit(
        db,
        user,
        device,
        "version_draft_submitted",
        dv.id,
        {"version_label": dv.version_label, "display_version_label": dv.resolved_display_label()},
    )
    log.info("device_version submitted as draft id=%s device_id=%s", dv.id, device.id)
    return dv


def isolate_device_version(db: Session, user: User, device_version_id: uuid.UUID) -> DeviceVersion:
    dv, device = _load_device_version_for_user(db, user, device_version_id)
    ensure_site_permission(db, user, device.site_id, "device_versions.isolate")
    if dv.status != "active" or dv.routing_lane != SHARED_LANE:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Isolate applies only to the active shared production version.",
        )
    dv.routing_lane = CANDIDATE_LANE
    dv.status = "isolated"
    db.add(dv)
    append_lineage_event(
        db,
        device,
        version_label=dv.resolved_display_label(),
        trigger_code="version_isolated",
        event_type="version_isolated",
        source_type="api",
        status="completed",
        payload_json={"device_version_id": str(dv.id)},
        created_by=user.id,
        ota_campaign_id=None,
        ota_external_ref=None,
        target_device_version_id=dv.id,
        previous_device_version_id=dv.previous_device_version_id,
    )
    db.flush()
    _emit_version_audit(
        db,
        user,
        device,
        "version_isolated",
        dv.id,
        {"version_label": dv.version_label, "display_version_label": dv.resolved_display_label()},
    )
    log.info("device_version isolated id=%s device_id=%s", dv.id, device.id)
    return dv


def rollback_device_version(db: Session, user: User, device_version_id: uuid.UUID) -> DeviceVersion:
    dv, device = _load_device_version_for_user(db, user, device_version_id)
    ensure_site_permission(db, user, device.site_id, "device_versions.rollback")
    if not dv.previous_device_version_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Device version has no previous_device_version_id; cannot rollback automatically.",
        )
    prev = db.get(DeviceVersion, dv.previous_device_version_id)
    if not prev or prev.device_id != device.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Previous device version row is missing or invalid.")
    now = datetime.now(timezone.utc)
    dv.status = "rolled_back"
    dv.deprecated_at = now
    db.add(dv)
    prev.status = "active"
    prev.routing_lane = SHARED_LANE
    prev.deprecated_at = None
    prev.activated_at = prev.activated_at or now
    db.add(prev)
    device.device_version = prev.resolved_display_label()
    db.add(device)
    append_lineage_event(
        db,
        device,
        version_label=prev.resolved_display_label(),
        trigger_code="version_rolled_back",
        event_type="version_rolled_back",
        source_type="api",
        status="completed",
        payload_json={"from_device_version_id": str(dv.id), "to_device_version_id": str(prev.id)},
        created_by=user.id,
        ota_campaign_id=None,
        ota_external_ref=None,
        target_device_version_id=prev.id,
        previous_device_version_id=dv.id,
    )
    db.flush()
    _emit_version_audit(
        db,
        user,
        device,
        "version_rolled_back",
        dv.id,
        {"from_device_version_id": str(dv.id), "to_device_version_id": str(prev.id), "to_version_label": prev.resolved_display_label()},
    )
    log.info("device_version rollback from=%s to=%s device_id=%s", dv.id, prev.id, device.id)
    return prev


def deprecate_device_version(db: Session, user: User, device_version_id: uuid.UUID) -> DeviceVersion:
    dv, device = _load_device_version_for_user(db, user, device_version_id)
    ensure_site_permission(db, user, device.site_id, "device_versions.deprecate")
    if dv.status in ("deprecated", "rolled_back"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Device version is already terminal.",
        )
    if dv.routing_lane == SHARED_LANE and dv.status == "active":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot deprecate the active shared device version; promote or rollback instead.",
        )
    now = datetime.now(timezone.utc)
    dv.status = "deprecated"
    dv.deprecated_at = now
    db.add(dv)
    append_lineage_event(
        db,
        device,
        version_label=dv.resolved_display_label(),
        trigger_code="version_deprecated",
        event_type="version_deprecated",
        source_type="api",
        status="completed",
        payload_json={"device_version_id": str(dv.id)},
        created_by=user.id,
        ota_campaign_id=None,
        ota_external_ref=None,
        target_device_version_id=dv.id,
        previous_device_version_id=dv.previous_device_version_id,
    )
    db.flush()
    _emit_version_audit(
        db,
        user,
        device,
        "version_deprecated",
        dv.id,
        {"version_label": dv.version_label, "display_version_label": dv.resolved_display_label()},
    )
    log.info("device_version deprecated id=%s device_id=%s", dv.id, device.id)
    return dv


def create_manual_device_version_draft(
    db: Session,
    user: User,
    *,
    device_id: uuid.UUID,
    display_version_label: str,
    system_version_key: str | None,
    notes: str | None,
    firmware_version: str | None = None,
    snapshot_config_version: str | None = None,
    snapshot_software_version: str | None = None,
) -> DeviceVersion:
    """Insert a ``draft`` ``device_versions`` row (manual); caller commits."""
    from app.services.device_version_lineage_service import _create_device_version_snapshot

    device = db.get(Device, device_id)
    if not device or device.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    ensure_site_permission(db, user, device.site_id, "devices.write")
    label = (display_version_label or "").strip()[:64]
    if not label:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "display_version_label is required.")
    dup = db.scalar(
        select(DeviceVersion.id)
        .where(DeviceVersion.device_id == device.id, DeviceVersion.version_label == label)
        .limit(1)
    )
    if dup:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A governed version with label {label!r} already exists for this device.",
        )
    prev = active_operational_device_version(db, device_id=device.id)
    prev_id = prev.id if prev else None
    sk = (system_version_key or "").strip()[:128] or None
    note_trim = (notes or "").strip()[:4096] or None
    cfg = (snapshot_config_version or "").strip()[:64] or None
    sw = (snapshot_software_version or "").strip()[:128] or None
    fw = (firmware_version or "").strip()[:128] or None
    dv = _create_device_version_snapshot(
        db,
        device,
        version_label=label,
        previous_device_version_id=prev_id,
        version_source="manual",
        created_by=user.id,
        routing_lane="shared",
        display_version_label=label,
        system_version_key=sk,
        status="draft",
        activated_at=None,
        config_version=cfg,
        software_version=sw,
        snapshot_firmware_version=fw,
    )
    _emit_version_audit(
        db,
        user,
        device,
        "manual_version_draft_created",
        dv.id,
        {
            "version_label": dv.version_label,
            "display_version_label": dv.resolved_display_label(),
            "notes": note_trim,
        },
    )
    return dv
