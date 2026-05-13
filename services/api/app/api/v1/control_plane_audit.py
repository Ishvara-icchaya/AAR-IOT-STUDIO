"""Phase 13 — list control-plane audit events (separate from device lineage)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.access_control import ensure_site_in_tenant
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.control_plane_audit import ControlPlaneAuditEventListResponse, ControlPlaneAuditEventRead
from app.services.control_plane_audit_service import list_control_plane_audit_events
from app.services.permission_service import effective_permissions_union_for_customer, ensure_site_permission

router = APIRouter()


@router.get("/events", response_model=ControlPlaneAuditEventListResponse)
def list_audit_events(
    site_id: uuid.UUID | None = Query(None),
    action_type: str | None = Query(None, max_length=64),
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if "audit.read" not in effective_permissions_union_for_customer(db, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing audit.read permission")
    if site_id is not None:
        if not ensure_site_in_tenant(db, user.customer_id, site_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
        ensure_site_permission(db, user, site_id, "audit.read")
    rows = list_control_plane_audit_events(
        db, user, site_id=site_id, action_type=action_type, limit=limit
    )
    return ControlPlaneAuditEventListResponse(
        items=[ControlPlaneAuditEventRead.model_validate(r) for r in rows],
    )
