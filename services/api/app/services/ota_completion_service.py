"""OTA campaign target completion (Phase 5)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.device import Device
from app.models.ota_campaign import OtaCampaign, OtaCampaignTarget, OtaEvent
from app.models.user import User
from app.services.device_version_lineage_service import append_lineage_event
from app.services.ota_executor_service import assert_campaign_simulator_token, release_expired_ota_claims
from app.services.permission_service import (
    user_has_site_permission,
    user_is_customer_admin,
)

log = logging.getLogger(__name__)

_TERMINAL_TARGET = frozenset(
    {"success", "failed", "rolled_back", "timeout", "cancelled"},
)
_FAILURE = frozenset({"failed", "rolled_back", "timeout", "cancelled"})


def _normalized_ota_ref(ota_external_ref: str | None, command_id: str | None) -> str:
    for s in (ota_external_ref, command_id):
        if s and str(s).strip():
            return str(s).strip()[:255]
    return ""


def _ensure_ota_status_caller(db: Session, user: User, site_id: uuid.UUID) -> None:
    if user_has_site_permission(db, user, site_id, "ota.executor.status"):
        return
    if user_has_site_permission(db, user, site_id, "ota.launch"):
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing ota.executor.status or ota.launch for this site")


def _maybe_finalize_campaign(db: Session, campaign: OtaCampaign) -> None:
    targets = list(
        db.scalars(select(OtaCampaignTarget).where(OtaCampaignTarget.campaign_id == campaign.id)).all()
    )
    if not targets:
        return
    if not all(t.status in _TERMINAL_TARGET for t in targets):
        return
    now = datetime.now(timezone.utc)
    if any(t.status in _FAILURE for t in targets):
        campaign.status = "failed"
    else:
        campaign.status = "completed"
    campaign.completed_at = now
    db.add(campaign)
    db.flush()


def complete_ota_target(
    db: Session,
    user: User,
    *,
    target_id: uuid.UUID,
    new_status: str,
    command_id: str | None = None,
    message: str | None = None,
    ota_external_ref: str | None = None,
    payload: dict[str, Any] | None = None,
    idempotency_key: str,
    admin_terminal_override: bool = False,
    bypass_site_ota_permission: bool = False,
) -> OtaCampaignTarget:
    """Validate campaign/target, update terminal state, append ``ota_job_completed`` lineage (no auto-promote)."""
    release_expired_ota_claims(db)
    key = (idempotency_key or "").strip()
    if not key or len(key) > 512:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Idempotency-Key header is required (max 512 chars)")

    tgt = db.get(OtaCampaignTarget, target_id)
    if not tgt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA target not found")
    camp = db.get(OtaCampaign, tgt.campaign_id)
    if not camp or camp.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA campaign not found")
    device = db.get(Device, tgt.device_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not bypass_site_ota_permission:
        _ensure_ota_status_caller(db, user, device.site_id)

    if new_status not in _TERMINAL_TARGET:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "status must be a terminal OTA target state")

    ext_ref = _normalized_ota_ref(ota_external_ref, command_id)

    if tgt.status in _TERMINAL_TARGET:
        stored_ref = (tgt.reported_ota_external_ref or "").strip()
        if tgt.status == new_status and stored_ref == ext_ref and ext_ref:
            log.info("ota target idempotent replay target_id=%s", target_id)
            return tgt
        if tgt.status_idempotency_key == key:
            return tgt
        if admin_terminal_override and (user.is_superuser or user_is_customer_admin(db, user)):
            pass
        else:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "OTA target is already terminal; conflicting status requires admin override",
            )
    else:
        if tgt.status not in ("command_sent", "claimed"):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "OTA target is not ready for terminal status (expected command_sent or claimed)",
            )
        if not ext_ref:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Provide ota_external_ref or command_id for terminal completion",
            )

    now = datetime.now(timezone.utc)
    tgt.status = new_status
    tgt.last_status_at = now
    tgt.completed_at = now
    tgt.reported_ota_external_ref = ext_ref or None
    tgt.status_idempotency_key = key[:512]
    if command_id:
        tgt.external_command_id = command_id[:255]
    if message:
        tgt.failure_message = message[:2000]
    db.add(tgt)

    ev_payload: dict[str, Any] = {
        "target_status": new_status,
        "campaign_id": str(camp.id),
        "device_id": str(device.id),
        "ota_external_ref": ext_ref or None,
    }
    if payload:
        ev_payload["detail"] = payload
    db.add(
        OtaEvent(
            id=uuid.uuid4(),
            campaign_id=camp.id,
            target_id=tgt.id,
            event_type="target_status",
            payload_json=ev_payload,
            created_at=now,
        )
    )

    vlabel = (device.device_version or "").strip() or "1"
    append_lineage_event(
        db,
        device,
        version_label=vlabel,
        trigger_code="ota_job_completed",
        event_type="ota_job_completed",
        source_type="ota",
        status=new_status,
        payload_json=ev_payload,
        created_by=user.id,
        ota_campaign_id=camp.id,
        ota_external_ref=ota_external_ref or command_id,
        target_device_version_id=tgt.target_device_version_id,
        previous_device_version_id=tgt.previous_device_version_id,
        kpi_snapshot=None,
    )

    _maybe_finalize_campaign(db, camp)
    db.flush()
    log.info("ota target completed target_id=%s status=%s", target_id, new_status)
    return tgt


def complete_ota_target_via_public_simulator(
    db: Session,
    *,
    campaign_id: uuid.UUID,
    token: str,
    target_id: uuid.UUID,
    new_status: str,
    command_id: str | None = None,
    message: str | None = None,
    ota_external_ref: str | None = None,
    payload: dict[str, Any] | None = None,
    idempotency_key: str,
) -> OtaCampaignTarget:
    """Same as ``complete_ota_target`` but auth is ``simulator_poll_token`` on the URL (no JWT)."""
    camp = assert_campaign_simulator_token(db.get(OtaCampaign, campaign_id), token)
    tgt = db.get(OtaCampaignTarget, target_id)
    if not tgt or tgt.campaign_id != camp.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OTA target not found")

    uid = camp.created_by
    if uid is None and settings.ota_api_actor_user_id is not None:
        u = db.get(User, settings.ota_api_actor_user_id)
        if u and u.customer_id == camp.customer_id:
            uid = settings.ota_api_actor_user_id
    if uid is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Public OTA status requires campaign created_by, or set OTA_API_ACTOR_USER_ID for this tenant.",
        )
    user = db.get(User, uid)
    if not user or user.customer_id != camp.customer_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Invalid actor for public OTA status")

    return complete_ota_target(
        db,
        user,
        target_id=target_id,
        new_status=new_status,
        command_id=command_id,
        message=message,
        ota_external_ref=ota_external_ref,
        payload=payload,
        idempotency_key=idempotency_key,
        admin_terminal_override=False,
        bypass_site_ota_permission=True,
    )
