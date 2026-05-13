"""Current user effective permissions (per site or union)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.access_control import ensure_site_in_tenant
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.permission_service import (
    effective_permissions_union_for_customer,
    resolve_permissions,
)

router = APIRouter()


class PermissionsMeResponse(BaseModel):
    site_id: str | None
    permission_keys: list[str]


@router.get("/me", response_model=PermissionsMeResponse)
def permissions_me(
    site_id: uuid.UUID | None = Query(None, description="When set, permissions for this site only."),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if site_id is not None:
        if not ensure_site_in_tenant(db, user.customer_id, site_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
        keys = sorted(resolve_permissions(db, user, site_id))
        return PermissionsMeResponse(site_id=str(site_id), permission_keys=keys)
    keys = sorted(effective_permissions_union_for_customer(db, user))
    return PermissionsMeResponse(site_id=None, permission_keys=keys)
