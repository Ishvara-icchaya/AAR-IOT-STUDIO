"""Site-scoped user directory and role bindings (RBAC)."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.access_control import ensure_site_in_tenant
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.rbac import Role, SiteUserRole
from app.models.site import Site
from app.models.user import User
from app.models.user_site import UserSite
from app.services.permission_service import (
    deactivate_site_user_role,
    ensure_site_permission,
    role_id_for_key,
    upsert_site_user_role,
)
from app.services.functional_audit_alert import emit_functional_audit_alert

router = APIRouter()
log = logging.getLogger(__name__)


class SiteUserInviteBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    role_key: str = Field(..., min_length=2, max_length=64)


class SiteUserRolesPatchBody(BaseModel):
    role_key: str = Field(..., min_length=2, max_length=64)


class SiteUserRow(BaseModel):
    user_id: str
    email: str
    full_name: str | None
    status: str
    role_key: str | None
    role_name: str | None
    sites_count: int
    last_login_at: str | None = None


class SiteUserListResponse(BaseModel):
    items: list[SiteUserRow]


def _status(u: User) -> str:
    return "active" if u.is_active else "inactive"


@router.get("/{site_id}/users", response_model=SiteUserListResponse)
def list_site_users(
    site_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ensure_site_in_tenant(db, user.customer_id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    ensure_site_permission(db, user, site_id, "users.read")

    rows = db.execute(
        select(User, Role.role_key, Role.name)
        .join(SiteUserRole, SiteUserRole.user_id == User.id)
        .join(Role, Role.id == SiteUserRole.role_id)
        .where(
            SiteUserRole.site_id == site_id,
            SiteUserRole.is_active.is_(True),
            User.customer_id == user.customer_id,
        )
        .order_by(User.email)
    ).all()

    out: list[SiteUserRow] = []
    for u, rk, rname in rows:
        n_sites = int(
            db.scalar(
                select(func.count())
                .select_from(SiteUserRole)
                .where(SiteUserRole.user_id == u.id, SiteUserRole.is_active.is_(True))
            )
            or 0
        )
        out.append(
            SiteUserRow(
                user_id=str(u.id),
                email=u.email,
                full_name=u.full_name,
                status=_status(u),
                role_key=rk,
                role_name=rname,
                sites_count=n_sites,
                last_login_at=None,
            )
        )
    return SiteUserListResponse(items=out)


@router.post("/{site_id}/users", response_model=SiteUserRow, status_code=status.HTTP_201_CREATED)
def invite_site_user(
    site_id: uuid.UUID,
    body: SiteUserInviteBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ensure_site_in_tenant(db, user.customer_id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    ensure_site_permission(db, user, site_id, "users.invite")

    rid = role_id_for_key(db, body.role_key)
    if rid is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown role_key")

    email = body.email.lower().strip()
    target = db.scalar(
        select(User)
        .options(joinedload(User.site_links))
        .where(User.email == email, User.customer_id == user.customer_id)
    )
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found in this tenant")

    upsert_site_user_role(db, site_id=site_id, user_id=target.id, role_id=rid, created_by=user.id)
    if not any(l.site_id == site_id for l in target.site_links):
        db.add(UserSite(user_id=target.id, site_id=site_id))
    db.commit()
    db.refresh(target)
    rk = db.scalar(select(Role.role_key).where(Role.id == rid))
    rname = db.scalar(select(Role.name).where(Role.id == rid))
    n_sites = int(
        db.scalar(
            select(func.count())
            .select_from(SiteUserRole)
            .where(SiteUserRole.user_id == target.id, SiteUserRole.is_active.is_(True))
        )
        or 0
    )
    log.debug("site_users.invite site_id=%s user_id=%s role=%s", site_id, target.id, body.role_key)
    site_row = db.get(Site, site_id)
    site_nm = (site_row.name or "").strip() if site_row else "Site"
    db.refresh(target)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="invited",
        resource_type="Site access",
        resource_label=f"{site_nm}: {target.email} ({body.role_key})",
        site_id=site_id,
        device_id=None,
        resource_created_at=target.created_at,
        resource_updated_at=target.updated_at,
        source_object_type="site_user_role",
        source_object_id=site_id,
    )
    return SiteUserRow(
        user_id=str(target.id),
        email=target.email,
        full_name=target.full_name,
        status=_status(target),
        role_key=rk,
        role_name=rname,
        sites_count=n_sites,
        last_login_at=None,
    )


@router.patch("/{site_id}/users/{target_user_id}/roles", response_model=SiteUserRow)
def patch_site_user_roles(
    site_id: uuid.UUID,
    target_user_id: uuid.UUID,
    body: SiteUserRolesPatchBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ensure_site_in_tenant(db, user.customer_id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    ensure_site_permission(db, user, site_id, "users.assign_roles")

    target = db.get(User, target_user_id)
    if not target or target.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    rid = role_id_for_key(db, body.role_key)
    if rid is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown role_key")

    upsert_site_user_role(db, site_id=site_id, user_id=target.id, role_id=rid, created_by=user.id)
    if not any(l.site_id == site_id for l in target.site_links):
        db.add(UserSite(user_id=target.id, site_id=site_id))
    db.commit()
    db.refresh(target)
    rk = db.scalar(select(Role.role_key).where(Role.id == rid))
    rname = db.scalar(select(Role.name).where(Role.id == rid))
    n_sites = int(
        db.scalar(
            select(func.count())
            .select_from(SiteUserRole)
            .where(SiteUserRole.user_id == target.id, SiteUserRole.is_active.is_(True))
        )
        or 0
    )
    site_row = db.get(Site, site_id)
    site_nm = (site_row.name or "").strip() if site_row else "Site"
    db.refresh(target)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="updated",
        resource_type="Site access",
        resource_label=f"{site_nm}: {target.email} → role {body.role_key}",
        site_id=site_id,
        device_id=None,
        resource_created_at=target.created_at,
        resource_updated_at=target.updated_at,
        source_object_type="site_user_role",
        source_object_id=site_id,
    )
    return SiteUserRow(
        user_id=str(target.id),
        email=target.email,
        full_name=target.full_name,
        status=_status(target),
        role_key=rk,
        role_name=rname,
        sites_count=n_sites,
        last_login_at=None,
    )


@router.delete("/{site_id}/users/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_site_user(
    site_id: uuid.UUID,
    target_user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ensure_site_in_tenant(db, user.customer_id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    ensure_site_permission(db, user, site_id, "users.assign_roles")

    if target_user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove yourself from the site")

    target = db.get(User, target_user_id)
    if not target or target.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    site_row = db.get(Site, site_id)
    site_nm = (site_row.name or "").strip() if site_row else "Site"
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="removed",
        resource_type="Site access",
        resource_label=f"{site_nm}: {target.email} removed",
        site_id=site_id,
        device_id=None,
        resource_created_at=target.created_at,
        resource_updated_at=target.updated_at,
        source_object_type="site_user_role",
        source_object_id=site_id,
    )
    deactivate_site_user_role(db, site_id, target_user_id)
    db.execute(
        UserSite.__table__.delete().where(
            UserSite.user_id == target_user_id,
            UserSite.site_id == site_id,
        )
    )
    db.commit()
    return None
