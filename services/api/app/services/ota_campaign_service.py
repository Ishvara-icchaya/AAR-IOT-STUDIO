"""OTA campaign CRUD and lifecycle (Phase 11 control plane)."""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control import ensure_site_in_tenant
from app.models.device import Device
from app.models.firmware_artifact import FirmwareArtifact
from app.models.device_version import DeviceVersion
from app.models.endpoint import Endpoint
from app.models.ota_campaign import OtaCampaign, OtaCampaignTarget, OtaEvent
from app.models.resolved_device import ResolvedDevice
from app.models.user import User
from app.services.permission_service import (
    ensure_site_permission,
    ensure_site_permission_any,
    site_ids_with_permission,
)

log = logging.getLogger(__name__)

_MISSING = object()

_TERMINAL_TARGET = frozenset(
    {"success", "failed", "rolled_back", "timeout", "cancelled"},
)
_TERMINAL_CAMPAIGN = frozenset({"completed", "failed", "rolled_back", "cancelled"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _append_event(
    db: Session,
    *,
    campaign_id: uuid.UUID,
    target_id: uuid.UUID | None,
    event_type: str,
    payload: dict[str, Any] | None,
    user_id: uuid.UUID | None,
) -> None:
    pl = dict(payload or {})
    if user_id:
        pl["actor_user_id"] = str(user_id)
    db.add(
        OtaEvent(
            id=uuid.uuid4(),
            campaign_id=campaign_id,
            target_id=target_id,
            event_type=event_type,
            payload_json=pl,
            created_at=_now(),
        )
    )


def _audit_campaign(
    db: Session,
    *,
    user: User,
    camp: OtaCampaign,
    action_type: str,
    payload: dict[str, Any] | None = None,
) -> None:
    from app.services.control_plane_audit_service import emit_control_plane_audit

    emit_control_plane_audit(
        db,
        customer_id=camp.customer_id,
        site_id=camp.site_id,
        actor_user_id=user.id,
        action_type=action_type,
        resource_type="ota_campaign",
        resource_id=camp.id,
        payload_json=payload,
    )


def resolved_device_id_for_device(db: Session, device: Device) -> uuid.UUID | None:
    ep_de = device.endpoint
    if ep_de is None:
        return None
    row = db.scalar(
        select(Endpoint.id).where(Endpoint.device_endpoint_id == ep_de.id).limit(1)
    )
    if row is None:
        return None
    rid = db.scalar(select(ResolvedDevice.id).where(ResolvedDevice.endpoint_id == row).limit(1))
    return rid


def latest_device_version_for_label(db: Session, device_id: uuid.UUID, version_label: str) -> DeviceVersion | None:
    return db.execute(
        select(DeviceVersion)
        .where(DeviceVersion.device_id == device_id, DeviceVersion.version_label == version_label)
        .order_by(DeviceVersion.created_at.desc(), DeviceVersion.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def load_campaign(db: Session, user: User, campaign_id: uuid.UUID) -> OtaCampaign:
    camp = db.get(OtaCampaign, campaign_id)
    if not camp or camp.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA campaign not found")
    return camp


def ensure_campaign_site_readable(db: Session, user: User, camp: OtaCampaign) -> None:
    if camp.site_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Campaign has no site scope")
    allowed = site_ids_with_permission(db, user, "ota.read")
    if allowed is not None and camp.site_id not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "OTA read not permitted for this site")


def list_campaigns_for_user(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID | None,
    status_filter: str | None,
) -> list[OtaCampaign]:
    allowed = site_ids_with_permission(db, user, "ota.read")
    if allowed is not None and len(allowed) == 0:
        return []

    stmt = select(OtaCampaign).where(OtaCampaign.customer_id == user.customer_id)
    if site_id is not None:
        if allowed is not None and site_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
        stmt = stmt.where(OtaCampaign.site_id == site_id)
    elif allowed is not None:
        stmt = stmt.where(OtaCampaign.site_id.in_(allowed))
    if status_filter and (sf := status_filter.strip()):
        stmt = stmt.where(OtaCampaign.status == sf)
    stmt = stmt.order_by(OtaCampaign.created_at.desc(), OtaCampaign.id.desc())
    return list(db.scalars(stmt).all())


def create_campaign(
    db: Session,
    user: User,
    *,
    name: str,
    site_id: uuid.UUID,
    target_firmware_version: str | None,
    target_device_version_id: uuid.UUID | None,
    rollout_strategy: str | None,
    artifact_id: uuid.UUID | None,
) -> OtaCampaign:
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site")
    ensure_site_permission(db, user, site_id, "ota.create")
    if target_device_version_id is not None:
        dv = db.get(DeviceVersion, target_device_version_id)
        if not dv:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "target_device_version_id not found")
        dev = db.get(Device, dv.device_id)
        if not dev or dev.customer_id != user.customer_id or dev.site_id != site_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Target device version must belong to a device in this site",
            )

    resolved_artifact_id: uuid.UUID | None = None
    if artifact_id is not None:
        art = db.get(FirmwareArtifact, artifact_id)
        if not art or art.customer_id != user.customer_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "artifact_id not found for this tenant")
        if art.site_id is not None and art.site_id != site_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Firmware artifact is scoped to a different site")
        resolved_artifact_id = art.id

    camp = OtaCampaign(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        site_id=site_id,
        name=name.strip()[:255],
        artifact_id=resolved_artifact_id,
        target_firmware_version=(target_firmware_version or "").strip()[:128] or None,
        target_device_version_id=target_device_version_id,
        status="draft",
        rollout_strategy=rollout_strategy,
        approval_status="pending",
        created_by=user.id,
        approved_by=None,
        started_at=None,
        completed_at=None,
        created_at=_now(),
    )
    db.add(camp)
    db.flush()
    _append_event(
        db,
        campaign_id=camp.id,
        target_id=None,
        event_type="campaign_created",
        payload={"name": camp.name, "site_id": str(site_id)},
        user_id=user.id,
    )
    db.flush()
    _audit_campaign(db, user=user, camp=camp, action_type="campaign_created", payload={"name": camp.name})
    log.info("ota campaign created id=%s site=%s", camp.id, site_id)
    return camp


def update_campaign_draft(
    db: Session,
    user: User,
    camp: OtaCampaign,
    *,
    name: str | None,
    target_firmware_version: str | None,
    rollout_strategy: str | None,
    target_device_version_id: uuid.UUID | None,
    artifact_id: uuid.UUID | None | object = _MISSING,
) -> OtaCampaign:
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission(db, user, camp.site_id, "ota.create")  # type: ignore[arg-type]
    if camp.status not in ("draft", "simulation_required"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign can only be edited in draft or simulation_required")
    changed = False
    if name is not None:
        camp.name = name.strip()[:255]
        changed = True
    if target_firmware_version is not None:
        camp.target_firmware_version = target_firmware_version.strip()[:128] or None
        changed = True
    if rollout_strategy is not None:
        camp.rollout_strategy = rollout_strategy
        changed = True
    if target_device_version_id is not None:
        dv = db.get(DeviceVersion, target_device_version_id)
        if not dv:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "target_device_version_id not found")
        dev = db.get(Device, dv.device_id)
        if not dev or dev.customer_id != user.customer_id or dev.site_id != camp.site_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Target device version must belong to a device in this site",
            )
        camp.target_device_version_id = target_device_version_id
        changed = True
    if artifact_id is not _MISSING:
        if artifact_id is None:
            camp.artifact_id = None
        else:
            aid = artifact_id  # type: ignore[assignment]
            art = db.get(FirmwareArtifact, aid)
            if not art or art.customer_id != user.customer_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "artifact_id not found for this tenant")
            if art.site_id is not None and art.site_id != camp.site_id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Firmware artifact is scoped to a different site")
            camp.artifact_id = art.id
        changed = True
    db.add(camp)
    db.flush()
    if changed:
        _append_event(db, campaign_id=camp.id, target_id=None, event_type="campaign_updated", payload={}, user_id=user.id)
        db.flush()
    return camp


def add_targets(
    db: Session,
    user: User,
    camp: OtaCampaign,
    device_ids: list[uuid.UUID],
) -> list[OtaCampaignTarget]:
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission(db, user, camp.site_id, "ota.create")  # type: ignore[arg-type]
    if camp.status not in ("draft", "simulation_required"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Targets can only be added while draft or simulation_required")

    site_id = camp.site_id
    assert site_id is not None

    existing = {
        t.device_id
        for t in db.scalars(
            select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == camp.id)
        ).all()
    }
    out: list[OtaCampaignTarget] = []
    for did in device_ids:
        if did in existing:
            continue
        device = db.get(Device, did)
        if not device or device.customer_id != user.customer_id or device.site_id != site_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Device {did} is not in this campaign site",
            )
        vlabel = (device.device_version or "").strip() or "1"
        prev_dv = latest_device_version_for_label(db, device.id, vlabel)
        rid = resolved_device_id_for_device(db, device)
        tgt = OtaCampaignTarget(
            id=uuid.uuid4(),
            campaign_id=camp.id,
            device_id=device.id,
            resolved_device_id=rid,
            previous_device_version_id=prev_dv.id if prev_dv else None,
            target_device_version_id=camp.target_device_version_id,
            current_firmware_version=(device.firmware_version or "").strip()[:128] or None,
            target_firmware_version=camp.target_firmware_version,
            status="queued",
            progress_pct=0,
            failure_code=None,
            failure_message=None,
            last_status_at=None,
            completed_at=None,
            external_command_id=None,
        )
        db.add(tgt)
        out.append(tgt)
        existing.add(did)

    db.flush()
    if out:
        _append_event(
            db,
            campaign_id=camp.id,
            target_id=None,
            event_type="targets_added",
            payload={"device_ids": [str(t.device_id) for t in out], "count": len(out)},
            user_id=user.id,
        )
        db.flush()
    return out


def remove_target(db: Session, user: User, camp: OtaCampaign, target_id: uuid.UUID) -> None:
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission(db, user, camp.site_id, "ota.create")  # type: ignore[arg-type]
    if camp.status not in ("draft", "simulation_required"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Targets can only be removed while draft or simulation_required")
    tgt = db.get(OtaCampaignTarget, target_id)
    if not tgt or tgt.campaign_id != camp.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA target not found")
    if tgt.status not in ("queued",):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only queued targets can be removed")
    db.delete(tgt)
    db.flush()
    _append_event(
        db,
        campaign_id=camp.id,
        target_id=None,
        event_type="target_removed",
        payload={"target_id": str(target_id)},
        user_id=user.id,
    )
    db.flush()


def submit_for_approval(db: Session, user: User, camp: OtaCampaign) -> OtaCampaign:
    """Freeze device targets at submit: membership is per-device rows only (no dynamic groups)."""
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission(db, user, camp.site_id, "ota.create")  # type: ignore[arg-type]
    if camp.status not in ("draft", "simulation_required"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only draft campaigns can be submitted")
    cnt = len(list(db.scalars(select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == camp.id)).all()))
    if cnt == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add at least one device target before submit")

    camp.status = "pending_approval"
    camp.approval_status = "pending"
    db.add(camp)
    db.flush()
    _append_event(db, campaign_id=camp.id, target_id=None, event_type="submitted_for_approval", payload={}, user_id=user.id)
    db.flush()
    _audit_campaign(db, user=user, camp=camp, action_type="campaign_submitted_for_approval")
    return camp


def approve_campaign(db: Session, user: User, camp: OtaCampaign) -> OtaCampaign:
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission(db, user, camp.site_id, "ota.approve")  # type: ignore[arg-type]
    if camp.status != "pending_approval":
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign is not pending approval")
    camp.status = "approved"
    camp.approval_status = "approved"
    camp.approved_by = user.id
    db.add(camp)
    db.flush()
    _append_event(db, campaign_id=camp.id, target_id=None, event_type="approved", payload={}, user_id=user.id)
    db.flush()
    _audit_campaign(db, user=user, camp=camp, action_type="campaign_approved")
    return camp


def _ensure_launch_permissions(db: Session, user: User, camp: OtaCampaign) -> None:
    assert camp.site_id is not None
    targets = list(db.scalars(select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == camp.id)).all())
    if not targets:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No targets to launch")
    for t in targets:
        dev = db.get(Device, t.device_id)
        if not dev:
            continue
        ensure_site_permission(db, user, dev.site_id, "ota.launch")


def launch_campaign(db: Session, user: User, camp: OtaCampaign) -> OtaCampaign:
    ensure_campaign_site_readable(db, user, camp)
    if camp.status != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign must be approved before launch")
    _ensure_launch_permissions(db, user, camp)
    now = _now()
    camp.status = "running"
    camp.started_at = now
    if not camp.simulator_poll_token:
        camp.simulator_poll_token = secrets.token_hex(32)
    db.add(camp)
    targets = list(db.scalars(select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == camp.id)).all())
    for t in targets:
        if t.status == "queued":
            t.status = "command_sent"
            t.last_status_at = now
            db.add(t)
            _append_event(
                db,
                campaign_id=camp.id,
                target_id=t.id,
                event_type="command_sent",
                payload={"device_id": str(t.device_id)},
                user_id=user.id,
            )
    db.flush()
    _append_event(db, campaign_id=camp.id, target_id=None, event_type="launched", payload={}, user_id=user.id)
    db.flush()
    _audit_campaign(db, user=user, camp=camp, action_type="campaign_launched")
    return camp


def pause_campaign(db: Session, user: User, camp: OtaCampaign) -> OtaCampaign:
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission(db, user, camp.site_id, "ota.launch")  # type: ignore[arg-type]
    if camp.status != "running":
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign is not running")
    camp.status = "paused"
    db.add(camp)
    db.flush()
    _append_event(db, campaign_id=camp.id, target_id=None, event_type="paused", payload={}, user_id=user.id)
    db.flush()
    return camp


def resume_campaign(db: Session, user: User, camp: OtaCampaign) -> OtaCampaign:
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission(db, user, camp.site_id, "ota.launch")  # type: ignore[arg-type]
    if camp.status != "paused":
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign is not paused")
    camp.status = "running"
    db.add(camp)
    db.flush()
    _append_event(db, campaign_id=camp.id, target_id=None, event_type="resumed", payload={}, user_id=user.id)
    db.flush()
    return camp


def cancel_campaign(db: Session, user: User, camp: OtaCampaign) -> OtaCampaign:
    ensure_campaign_site_readable(db, user, camp)
    ensure_site_permission_any(db, user, camp.site_id, ("ota.launch", "ota.rollback"))  # type: ignore[arg-type]
    if camp.status in _TERMINAL_CAMPAIGN:
        raise HTTPException(status.HTTP_409_CONFLICT, "Campaign is already terminal")
    now = _now()
    camp.status = "cancelled"
    camp.completed_at = now
    db.add(camp)
    targets = list(db.scalars(select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == camp.id)).all())
    for t in targets:
        if t.status not in _TERMINAL_TARGET:
            t.status = "cancelled"
            t.completed_at = now
            t.last_status_at = now
            db.add(t)
    db.flush()
    _append_event(db, campaign_id=camp.id, target_id=None, event_type="cancelled", payload={}, user_id=user.id)
    db.flush()
    _audit_campaign(db, user=user, camp=camp, action_type="campaign_cancelled")
    return camp


def list_events(db: Session, user: User, camp: OtaCampaign, limit: int = 200) -> list[OtaEvent]:
    ensure_campaign_site_readable(db, user, camp)
    rows = list(
        db.scalars(
            select(OtaEvent)
            .where(OtaEvent.campaign_id == camp.id)
            .order_by(OtaEvent.created_at.desc(), OtaEvent.id.desc())
            .limit(limit)
        ).all()
    )
    return rows


def create_firmware_artifact(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID,
    artifact_url: str,
    sha256: str,
    signature: str | None,
    signature_algorithm: str | None,
    size_bytes: int | None,
    release_notes: str | None,
) -> FirmwareArtifact:
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site")
    ensure_site_permission(db, user, site_id, "ota.create")
    row = FirmwareArtifact(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        site_id=site_id,
        artifact_url=artifact_url.strip(),
        sha256=sha256.strip()[:128],
        signature=(signature.strip() if signature else None) or None,
        signature_algorithm=(signature_algorithm.strip()[:64] if signature_algorithm else None) or None,
        size_bytes=size_bytes,
        release_notes=(release_notes.strip() if release_notes else None) or None,
        created_at=_now(),
    )
    db.add(row)
    db.flush()
    return row


def list_firmware_artifacts(db: Session, user: User, *, site_id: uuid.UUID) -> list[FirmwareArtifact]:
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site")
    ensure_site_permission(db, user, site_id, "ota.read")
    return list(
        db.scalars(
            select(FirmwareArtifact)
            .where(FirmwareArtifact.customer_id == user.customer_id, FirmwareArtifact.site_id == site_id)
            .order_by(FirmwareArtifact.created_at.desc(), FirmwareArtifact.id.desc())
        ).all()
    )
