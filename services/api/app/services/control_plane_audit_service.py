"""Emit control-plane audit rows (Phase 13), separate from device lineage."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.control_plane_audit import ControlPlaneAuditEvent
from app.models.user import User
from app.services.permission_service import site_ids_with_permission


def emit_control_plane_audit(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID | None,
    actor_user_id: uuid.UUID | None,
    action_type: str,
    resource_type: str,
    resource_id: uuid.UUID | None = None,
    correlation_id: str | None = None,
    payload_json: dict[str, Any] | None = None,
) -> ControlPlaneAuditEvent:
    row = ControlPlaneAuditEvent(
        id=uuid.uuid4(),
        customer_id=customer_id,
        site_id=site_id,
        actor_user_id=actor_user_id,
        action_type=action_type[:64],
        resource_type=resource_type[:64],
        resource_id=resource_id,
        correlation_id=(correlation_id[:255] if correlation_id else None),
        payload_json=payload_json,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    return row


def list_control_plane_audit_events(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID | None,
    action_type: str | None,
    limit: int,
) -> list[ControlPlaneAuditEvent]:
    """List audit rows for the tenant; optional filter by site and action_type."""
    q = select(ControlPlaneAuditEvent).where(ControlPlaneAuditEvent.customer_id == user.customer_id)
    allowed_sites = site_ids_with_permission(db, user, "audit.read")
    if allowed_sites is not None:
        if not allowed_sites:
            return []
        if site_id is not None:
            if site_id not in allowed_sites:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing audit.read for this site")
            q = q.where(ControlPlaneAuditEvent.site_id == site_id)
        else:
            q = q.where(
                or_(
                    ControlPlaneAuditEvent.site_id.in_(allowed_sites),
                    ControlPlaneAuditEvent.site_id.is_(None),
                )
            )
    elif site_id is not None:
        q = q.where(ControlPlaneAuditEvent.site_id == site_id)

    if action_type:
        q = q.where(ControlPlaneAuditEvent.action_type == action_type[:64])

    q = q.order_by(ControlPlaneAuditEvent.created_at.desc(), ControlPlaneAuditEvent.id.desc()).limit(limit)
    return list(db.scalars(q).all())
