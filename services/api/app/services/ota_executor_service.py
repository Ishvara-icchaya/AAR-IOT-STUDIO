"""Executor pull queue, claim/lease, and non-terminal progress (OTA transport)."""

from __future__ import annotations

import base64
import json
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.device import Device
from app.models.firmware_artifact import FirmwareArtifact
from app.models.ota_campaign import OtaCampaign, OtaCampaignTarget, OtaEvent
from app.models.user import User
from app.services.permission_service import ensure_site_permission, site_ids_with_permission

log = logging.getLogger(__name__)

_TERMINAL_TARGET = frozenset(
    {"success", "failed", "rolled_back", "timeout", "cancelled"},
)

_PROGRESS_PHASES = frozenset({"acknowledged", "downloading", "verifying", "installing", "rebooting"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def release_expired_ota_claims(db: Session) -> int:
    """Return ``claimed`` targets whose lease expired to ``command_sent``."""
    now = _now()
    rows = list(
        db.scalars(
            select(OtaCampaignTarget).where(
                OtaCampaignTarget.status == "claimed",
                OtaCampaignTarget.lease_expires_at.is_not(None),
                OtaCampaignTarget.lease_expires_at < now,
            )
        ).all()
    )
    for t in rows:
        t.status = "command_sent"
        t.claimed_by = None
        t.claimed_at = None
        t.lease_expires_at = None
        db.add(t)
    if rows:
        db.flush()
    return len(rows)


def _decode_cursor(cursor: str | None) -> uuid.UUID | None:
    if not cursor or not cursor.strip():
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.strip() + "==")
        data = json.loads(raw.decode("utf-8"))
        return uuid.UUID(str(data["id"]))
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid cursor") from None


def _encode_cursor(last_id: uuid.UUID) -> str:
    raw = json.dumps({"id": str(last_id)}).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


@dataclass
class OtaExecutorWorkItem:
    campaign_id: uuid.UUID
    target_id: uuid.UUID
    device_id: uuid.UUID
    device_display_id: str
    resolved_device_id: uuid.UUID | None
    target_firmware_version: str | None
    target_device_version_id: uuid.UUID | None
    artifact: dict[str, Any]


def _artifact_payload(art: FirmwareArtifact | None) -> dict[str, Any]:
    if not art:
        return {}
    return {
        "url": art.artifact_url,
        "sha256": art.sha256,
        "signature": art.signature,
        "signature_algorithm": art.signature_algorithm,
        "size_bytes": art.size_bytes,
        "release_notes": art.release_notes,
    }


def assert_campaign_simulator_token(camp: OtaCampaign | None, token: str) -> OtaCampaign:
    """Validate ``token`` against ``camp.simulator_poll_token`` or raise 404 (indistinguishable)."""
    tok = (token or "").strip()
    if not camp or not camp.simulator_poll_token or not tok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if len(tok) > 96 or len(camp.simulator_poll_token) > 96:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if not secrets.compare_digest(camp.simulator_poll_token, tok):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return camp


def list_public_campaign_poll_work(
    db: Session,
    *,
    campaign_id: uuid.UUID,
    token: str,
    limit: int,
    cursor: str | None,
) -> tuple[list[OtaExecutorWorkItem], str | None, str, str, str]:
    """Return work items for one campaign when ``token`` matches ``simulator_poll_token``.

    Raises ``HTTPException(404)`` for unknown id or bad token (indistinguishable).
    """
    release_expired_ota_claims(db)
    camp = assert_campaign_simulator_token(db.get(OtaCampaign, campaign_id), token)

    if camp.status != "running":
        return [], None, camp.name, camp.status, "campaign_not_releasing_work"

    after_id = _decode_cursor(cursor)
    stmt = (
        select(OtaCampaignTarget)
        .join(OtaCampaign, OtaCampaign.id == OtaCampaignTarget.campaign_id)
        .join(Device, Device.id == OtaCampaignTarget.device_id)
        .options(joinedload(OtaCampaignTarget.campaign).joinedload(OtaCampaign.firmware_artifact))
        .where(
            OtaCampaignTarget.campaign_id == campaign_id,
            OtaCampaignTarget.status == "command_sent",
            OtaCampaign.status == "running",
        )
        .order_by(OtaCampaignTarget.id.asc())
        .limit(limit + 1)
    )
    if after_id is not None:
        stmt = stmt.where(OtaCampaignTarget.id > after_id)

    rows = list(db.scalars(stmt).unique().all())
    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = _encode_cursor(rows[-1].id)

    out: list[OtaExecutorWorkItem] = []
    for t in rows:
        dev = db.get(Device, t.device_id)
        if not dev:
            continue
        c = t.campaign
        art = c.firmware_artifact if c else None
        display = (dev.name or "").strip() or str(dev.id)
        out.append(
            OtaExecutorWorkItem(
                campaign_id=t.campaign_id,
                target_id=t.id,
                device_id=t.device_id,
                device_display_id=display,
                resolved_device_id=t.resolved_device_id,
                target_firmware_version=t.target_firmware_version or c.target_firmware_version,
                target_device_version_id=t.target_device_version_id or c.target_device_version_id,
                artifact=_artifact_payload(art),
            )
        )
    return out, next_cursor, camp.name, camp.status, "ok"


def list_ota_targets_bearer_scoped(
    db: Session,
    *,
    customer_id: uuid.UUID,
    status_filter: str,
    limit: int,
    cursor: str | None,
) -> tuple[list[OtaExecutorWorkItem], str | None]:
    """Same queue as ``list_executor_work`` for one tenant (machine bearer; all sites in tenant)."""
    release_expired_ota_claims(db)
    if status_filter != "command_sent":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only status=command_sent is supported for this queue")

    after_id = _decode_cursor(cursor)
    stmt = (
        select(OtaCampaignTarget)
        .join(OtaCampaign, OtaCampaign.id == OtaCampaignTarget.campaign_id)
        .join(Device, Device.id == OtaCampaignTarget.device_id)
        .options(joinedload(OtaCampaignTarget.campaign).joinedload(OtaCampaign.firmware_artifact))
        .where(
            OtaCampaignTarget.status == "command_sent",
            OtaCampaign.status == "running",
            OtaCampaign.customer_id == customer_id,
        )
        .order_by(OtaCampaignTarget.id.asc())
        .limit(limit + 1)
    )
    if after_id is not None:
        stmt = stmt.where(OtaCampaignTarget.id > after_id)

    rows = list(db.scalars(stmt).unique().all())
    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = _encode_cursor(rows[-1].id)

    out: list[OtaExecutorWorkItem] = []
    for t in rows:
        dev = db.get(Device, t.device_id)
        if not dev:
            continue
        camp = t.campaign
        art = camp.firmware_artifact if camp else None
        display = (dev.name or "").strip() or str(dev.id)
        out.append(
            OtaExecutorWorkItem(
                campaign_id=t.campaign_id,
                target_id=t.id,
                device_id=t.device_id,
                device_display_id=display,
                resolved_device_id=t.resolved_device_id,
                target_firmware_version=t.target_firmware_version or camp.target_firmware_version,
                target_device_version_id=t.target_device_version_id or camp.target_device_version_id,
                artifact=_artifact_payload(art),
            )
        )
    return out, next_cursor


def list_executor_work(
    db: Session,
    user: User,
    *,
    status_filter: str,
    limit: int,
    cursor: str | None,
) -> tuple[list[OtaExecutorWorkItem], str | None]:
    release_expired_ota_claims(db)
    if status_filter != "command_sent":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only status=command_sent is supported for this queue")

    allowed_sites = site_ids_with_permission(db, user, "ota.executor.read")
    if allowed_sites is not None and len(allowed_sites) == 0:
        return [], None

    after_id = _decode_cursor(cursor)
    stmt = (
        select(OtaCampaignTarget)
        .join(OtaCampaign, OtaCampaign.id == OtaCampaignTarget.campaign_id)
        .join(Device, Device.id == OtaCampaignTarget.device_id)
        .options(joinedload(OtaCampaignTarget.campaign).joinedload(OtaCampaign.firmware_artifact))
        .where(
            OtaCampaignTarget.status == "command_sent",
            OtaCampaign.status == "running",
            OtaCampaign.customer_id == user.customer_id,
        )
        .order_by(OtaCampaignTarget.id.asc())
        .limit(limit + 1)
    )
    if allowed_sites is not None:
        stmt = stmt.where(Device.site_id.in_(allowed_sites))
    if after_id is not None:
        stmt = stmt.where(OtaCampaignTarget.id > after_id)

    rows = list(db.scalars(stmt).unique().all())
    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = _encode_cursor(rows[-1].id)

    out: list[OtaExecutorWorkItem] = []
    for t in rows:
        dev = db.get(Device, t.device_id)
        if not dev:
            continue
        camp = t.campaign
        art = camp.firmware_artifact if camp else None
        display = (dev.name or "").strip() or str(dev.id)
        out.append(
            OtaExecutorWorkItem(
                campaign_id=t.campaign_id,
                target_id=t.id,
                device_id=t.device_id,
                device_display_id=display,
                resolved_device_id=t.resolved_device_id,
                target_firmware_version=t.target_firmware_version or camp.target_firmware_version,
                target_device_version_id=t.target_device_version_id or camp.target_device_version_id,
                artifact=_artifact_payload(art),
            )
        )
    return out, next_cursor


def claim_ota_target(
    db: Session,
    user: User,
    *,
    target_id: uuid.UUID,
    executor_id: str,
    lease_seconds: int,
) -> OtaCampaignTarget:
    release_expired_ota_claims(db)
    if lease_seconds < 30 or lease_seconds > 86400:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "lease_seconds must be between 30 and 86400")
    ex = executor_id.strip()
    if not ex or len(ex) > 255:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "executor_id is required")

    tgt = db.get(OtaCampaignTarget, target_id)
    if not tgt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA target not found")
    camp = db.get(OtaCampaign, tgt.campaign_id)
    if not camp or camp.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA campaign not found")
    device = db.get(Device, tgt.device_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    ensure_site_permission(db, user, device.site_id, "ota.executor.claim")

    now = _now()
    lease_until = now + timedelta(seconds=lease_seconds)

    if tgt.status == "command_sent":
        tgt.status = "claimed"
        tgt.claimed_by = ex[:255]
        tgt.claimed_at = now
        tgt.lease_expires_at = lease_until
        tgt.last_status_at = now
        db.add(tgt)
        db.add(
            OtaEvent(
                id=uuid.uuid4(),
                campaign_id=camp.id,
                target_id=tgt.id,
                event_type="target_claimed",
                payload_json={"executor_id": ex, "lease_expires_at": lease_until.isoformat()},
                created_at=now,
            )
        )
        db.flush()
        return tgt

    if tgt.status == "claimed":
        if tgt.claimed_by == ex:
            tgt.lease_expires_at = lease_until
            tgt.last_status_at = now
            db.add(tgt)
            db.flush()
            return tgt
        if tgt.lease_expires_at and tgt.lease_expires_at > now:
            raise HTTPException(status.HTTP_409_CONFLICT, "Target is claimed by another executor")
        tgt.status = "command_sent"
        tgt.claimed_by = None
        tgt.claimed_at = None
        tgt.lease_expires_at = None
        db.add(tgt)
        db.flush()
        return claim_ota_target(db, user, target_id=target_id, executor_id=executor_id, lease_seconds=lease_seconds)

    raise HTTPException(status.HTTP_409_CONFLICT, "Target cannot be claimed in its current state")


def report_ota_progress(
    db: Session,
    user: User,
    *,
    target_id: uuid.UUID,
    phase: str,
    message: str | None,
    payload: dict[str, Any] | None,
) -> OtaCampaignTarget:
    release_expired_ota_claims(db)
    ph = phase.strip().lower()
    if ph not in _PROGRESS_PHASES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"phase must be one of: {', '.join(sorted(_PROGRESS_PHASES))}",
        )

    tgt = db.get(OtaCampaignTarget, target_id)
    if not tgt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA target not found")
    if tgt.status in _TERMINAL_TARGET:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot report progress for a terminal target")
    camp = db.get(OtaCampaign, tgt.campaign_id)
    if not camp or camp.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA campaign not found")
    device = db.get(Device, tgt.device_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    ensure_site_permission(db, user, device.site_id, "ota.executor.progress")

    now = _now()
    tgt.progress_phase = ph[:32]
    tgt.last_status_at = now
    if message:
        tgt.failure_message = message[:2000]
    db.add(tgt)
    pl: dict[str, Any] = {"phase": ph}
    if message:
        pl["message"] = message[:2000]
    if payload:
        pl["detail"] = payload
    db.add(
        OtaEvent(
            id=uuid.uuid4(),
            campaign_id=camp.id,
            target_id=tgt.id,
            event_type="target_progress",
            payload_json=pl,
            created_at=now,
        )
    )
    db.flush()
    return tgt
