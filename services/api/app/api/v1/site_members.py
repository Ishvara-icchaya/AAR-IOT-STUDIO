"""Site membership and site-scoped role bindings."""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.access_control import ensure_site_in_tenant
from app.api.deps import get_current_user
from app.core.security import hash_password
from app.db.session import get_db
from app.models.rbac import Role, SiteUserRole
from app.models.user import User
from app.models.user_site import UserSite
from app.services.permission_catalog import SITE_ROLE_KEYS
from app.services.permission_service import (
    deactivate_site_user_role,
    ensure_site_permission,
    role_id_for_key,
    upsert_site_user_role,
)

router = APIRouter()
log = logging.getLogger(__name__)


class SiteMemberCreateBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str = Field(..., min_length=3, max_length=320)
    role: str = Field(
        ...,
        min_length=2,
        max_length=64,
        validation_alias=AliasChoices("role", "role_key"),
    )


class SiteMemberRolePatchBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    role: str = Field(
        ...,
        min_length=2,
        max_length=64,
        validation_alias=AliasChoices("role", "role_key"),
    )


class SiteMemberRow(BaseModel):
    user_id: str
    email: str
    full_name: str | None
    status: str
    role_key: str | None
    role_name: str | None
    sites_count: int
    last_login_at: str | None = None


class SiteMemberListResponse(BaseModel):
    items: list[SiteMemberRow]


def _row_from_user(db: Session, u: User, _site_id: uuid.UUID, rid: uuid.UUID) -> SiteMemberRow:
    rk = db.scalar(select(Role.role_key).where(Role.id == rid))
    rname = db.scalar(select(Role.name).where(Role.id == rid))
    n_sites = int(
        db.scalar(
            select(func.count())
            .select_from(SiteUserRole)
            .where(SiteUserRole.user_id == u.id, SiteUserRole.is_active.is_(True))
        )
        or 0
    )
    last_login = u.last_login_at.isoformat() if u.last_login_at else None
    return SiteMemberRow(
        user_id=str(u.id),
        email=u.email,
        full_name=u.full_name,
        status=u.account_status,
        role_key=rk,
        role_name=rname,
        sites_count=n_sites,
        last_login_at=last_login,
    )


def _assert_site_assignable_role(db: Session, role_key: str) -> uuid.UUID:
    if role_key not in SITE_ROLE_KEYS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Role must be a site-scoped role (not customer_admin or platform_admin).",
        )
    rid = role_id_for_key(db, role_key)
    if rid is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown role")
    return rid


@router.get("/{site_id}/members", response_model=SiteMemberListResponse)
def list_site_members(
    site_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ensure_site_in_tenant(db, user.customer_id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    ensure_site_permission(db, user, site_id, "users.read")

    rows = db.execute(
        select(User, Role.id)
        .join(SiteUserRole, SiteUserRole.user_id == User.id)
        .join(Role, Role.id == SiteUserRole.role_id)
        .where(
            SiteUserRole.site_id == site_id,
            SiteUserRole.is_active.is_(True),
            User.customer_id == user.customer_id,
        )
        .order_by(User.email)
    ).all()

    out = [_row_from_user(db, u, site_id, rid) for u, rid in rows]
    return SiteMemberListResponse(items=out)


@router.post("/{site_id}/members", response_model=SiteMemberRow, status_code=status.HTTP_201_CREATED)
def add_site_member(
    site_id: uuid.UUID,
    body: SiteMemberCreateBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ensure_site_in_tenant(db, user.customer_id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    ensure_site_permission(db, user, site_id, "users.invite")

    role_key = body.role.strip()
    rid = _assert_site_assignable_role(db, role_key)
    email = body.email.lower().strip()

    target = db.scalar(
        select(User)
        .options(joinedload(User.site_links))
        .where(User.email == email, User.customer_id == user.customer_id)
    )
    if not target:
        placeholder_pw = secrets.token_urlsafe(32)
        target = User(
            id=uuid.uuid4(),
            customer_id=user.customer_id,
            email=email,
            full_name=None,
            hashed_password=hash_password(placeholder_pw),
            is_active=False,
            is_superuser=False,
            role="operator",
            must_change_password=True,
            account_status="invited",
            invited_at=datetime.now(timezone.utc),
            invited_by=user.id,
        )
        db.add(target)
        db.flush()

    upsert_site_user_role(db, site_id=site_id, user_id=target.id, role_id=rid, created_by=user.id)
    if not any(l.site_id == site_id for l in target.site_links):
        db.add(UserSite(user_id=target.id, site_id=site_id))
    db.commit()
    db.refresh(target)
    log.debug("site_members.add site_id=%s user_id=%s role=%s", site_id, target.id, role_key)
    return _row_from_user(db, target, site_id, rid)


@router.patch("/{site_id}/members/{target_user_id}/role", response_model=SiteMemberRow)
def patch_site_member_role(
    site_id: uuid.UUID,
    target_user_id: uuid.UUID,
    body: SiteMemberRolePatchBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ensure_site_in_tenant(db, user.customer_id, site_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    ensure_site_permission(db, user, site_id, "users.assign_roles")

    target = db.get(User, target_user_id)
    if not target or target.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    role_key = body.role.strip()
    rid = _assert_site_assignable_role(db, role_key)

    upsert_site_user_role(db, site_id=site_id, user_id=target.id, role_id=rid, created_by=user.id)
    if not any(l.site_id == site_id for l in target.site_links):
        db.add(UserSite(user_id=target.id, site_id=site_id))
    db.commit()
    db.refresh(target)
    return _row_from_user(db, target, site_id, rid)


@router.delete("/{site_id}/members/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_site_member(
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

    deactivate_site_user_role(db, site_id, target_user_id)
    db.execute(
        UserSite.__table__.delete().where(
            UserSite.user_id == target_user_id,
            UserSite.site_id == site_id,
        )
    )
    db.commit()
    return None
