"""RBAC: single permission resolver + tenant/site bindings."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.rbac import Permission, Role, RolePermission, SiteUserRole, TenantUserRole
from app.models.site import Site
from app.models.user import User
from app.services.permission_catalog import ALL_PERMISSION_KEYS_SET


def role_id_for_key(db: Session, role_key: str) -> uuid.UUID | None:
    return db.scalar(select(Role.id).where(Role.role_key == role_key))


def resolve_permissions(db: Session, user: User, site_id: uuid.UUID) -> set[str]:
    """Single source of truth: superuser → all; else tenant roles ∪ site roles for this site."""
    if user.is_superuser:
        return set(ALL_PERMISSION_KEYS_SET)
    site = db.get(Site, site_id)
    if not site or site.customer_id != user.customer_id:
        return set()
    tenant_keys = _permission_keys_for_tenant_roles(db, user.id, site.customer_id)
    site_keys = _permission_keys_for_site_roles(db, user.id, site_id)
    return tenant_keys | site_keys


def _permission_keys_for_tenant_roles(db: Session, user_id: uuid.UUID, customer_id: uuid.UUID) -> set[str]:
    rows = db.execute(
        select(Permission.permission_key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(TenantUserRole, TenantUserRole.role_id == Role.id)
        .where(
            TenantUserRole.user_id == user_id,
            TenantUserRole.customer_id == customer_id,
            TenantUserRole.is_active.is_(True),
        )
    ).all()
    return {r[0] for r in rows}


def _permission_keys_for_site_roles(db: Session, user_id: uuid.UUID, site_id: uuid.UUID) -> set[str]:
    rows = db.execute(
        select(Permission.permission_key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(SiteUserRole, SiteUserRole.role_id == Role.id)
        .where(
            SiteUserRole.user_id == user_id,
            SiteUserRole.site_id == site_id,
            SiteUserRole.is_active.is_(True),
        )
    ).all()
    return {r[0] for r in rows}


def effective_permissions_for_site(db: Session, user: User, site_id: uuid.UUID) -> set[str]:
    """Alias for callers; prefer resolve_permissions."""
    return resolve_permissions(db, user, site_id)


def user_has_site_permission(db: Session, user: User, site_id: uuid.UUID, permission_key: str) -> bool:
    return permission_key in resolve_permissions(db, user, site_id)


def ensure_site_permission(db: Session, user: User, site_id: uuid.UUID, permission_key: str) -> None:
    if not user_has_site_permission(db, user, site_id, permission_key):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing required permission for this site")


def ensure_site_permission_any(
    db: Session, user: User, site_id: uuid.UUID, permission_keys: tuple[str, ...],
) -> None:
    if any(user_has_site_permission(db, user, site_id, k) for k in permission_keys):
        return
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        f"Missing required permission for this site (need one of: {', '.join(permission_keys)})",
    )


def effective_permissions_union_for_customer(db: Session, user: User) -> set[str]:
    """Union of permissions across tenant bindings and all site bindings in the tenant."""
    if user.is_superuser:
        return set(ALL_PERMISSION_KEYS_SET)
    tenant_keys = _permission_keys_for_tenant_roles(db, user.id, user.customer_id)
    rows = db.execute(
        select(Permission.permission_key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .join(SiteUserRole, SiteUserRole.role_id == Role.id)
        .join(Site, Site.id == SiteUserRole.site_id)
        .where(
            SiteUserRole.user_id == user.id,
            SiteUserRole.is_active.is_(True),
            Site.customer_id == user.customer_id,
        )
        .distinct()
    ).all()
    site_union = {r[0] for r in rows}
    return tenant_keys | site_union


def site_ids_with_permission(db: Session, user: User, permission_key: str) -> list[uuid.UUID] | None:
    """None = all tenant sites (superuser or tenant-wide permission). Else explicit site UUIDs."""
    if user.is_superuser:
        return None
    if permission_key in _permission_keys_for_tenant_roles(db, user.id, user.customer_id):
        return None
    rows = db.scalars(
        select(SiteUserRole.site_id)
        .join(RolePermission, RolePermission.role_id == SiteUserRole.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .join(Site, Site.id == SiteUserRole.site_id)
        .where(
            SiteUserRole.user_id == user.id,
            SiteUserRole.is_active.is_(True),
            Permission.permission_key == permission_key,
            Site.customer_id == user.customer_id,
        )
        .distinct()
    ).all()
    return list(rows)


def user_is_customer_admin(db: Session, user: User) -> bool:
    if user.is_superuser:
        return True
    rid = db.scalar(select(Role.id).where(Role.role_key == "customer_admin"))
    if rid is None:
        return False
    return bool(
        db.scalar(
            select(TenantUserRole.id).where(
                TenantUserRole.user_id == user.id,
                TenantUserRole.customer_id == user.customer_id,
                TenantUserRole.role_id == rid,
                TenantUserRole.is_active.is_(True),
            ).limit(1)
        )
    )


def upsert_site_user_role(
    db: Session,
    *,
    site_id: uuid.UUID,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
    created_by: uuid.UUID | None,
) -> SiteUserRole:
    now = datetime.now(timezone.utc)
    existing = db.scalar(
        select(SiteUserRole).where(SiteUserRole.site_id == site_id, SiteUserRole.user_id == user_id)
    )
    if existing:
        existing.role_id = role_id
        existing.is_active = True
        existing.created_at = now
        if created_by is not None:
            existing.created_by = created_by
        return existing
    row = SiteUserRole(
        id=uuid.uuid4(),
        site_id=site_id,
        user_id=user_id,
        role_id=role_id,
        created_at=now,
        created_by=created_by,
        is_active=True,
    )
    db.add(row)
    return row


def upsert_tenant_user_role(
    db: Session,
    *,
    customer_id: uuid.UUID,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
    created_by: uuid.UUID | None,
) -> TenantUserRole:
    now = datetime.now(timezone.utc)
    existing = db.scalar(
        select(TenantUserRole).where(
            TenantUserRole.customer_id == customer_id,
            TenantUserRole.user_id == user_id,
        )
    )
    if existing:
        existing.role_id = role_id
        existing.is_active = True
        existing.created_at = now
        if created_by is not None:
            existing.created_by = created_by
        return existing
    row = TenantUserRole(
        id=uuid.uuid4(),
        customer_id=customer_id,
        user_id=user_id,
        role_id=role_id,
        created_at=now,
        created_by=created_by,
        is_active=True,
    )
    db.add(row)
    return row


def deactivate_site_user_role(db: Session, site_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    row = db.scalar(
        select(SiteUserRole).where(SiteUserRole.site_id == site_id, SiteUserRole.user_id == user_id)
    )
    if not row:
        return False
    row.is_active = False
    return True


def site_ids_with_any_active_binding(db: Session, user: User) -> list[uuid.UUID] | None:
    """Sites visible in selector: all tenant sites if any active tenant binding; else sites with site role."""
    if user.is_superuser:
        return None
    has_tenant = bool(
        db.scalar(
            select(TenantUserRole.id)
            .where(
                TenantUserRole.user_id == user.id,
                TenantUserRole.customer_id == user.customer_id,
                TenantUserRole.is_active.is_(True),
            )
            .limit(1)
        )
    )
    if has_tenant:
        return None
    rows = db.scalars(
        select(SiteUserRole.site_id)
        .join(Site, Site.id == SiteUserRole.site_id)
        .where(
            SiteUserRole.user_id == user.id,
            SiteUserRole.is_active.is_(True),
            Site.customer_id == user.customer_id,
        )
        .distinct()
    ).all()
    return list(rows)
