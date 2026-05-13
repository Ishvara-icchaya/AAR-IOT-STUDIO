"""Catalog of RBAC roles (authenticated)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.rbac import Permission, Role, RolePermission
from app.models.user import User

router = APIRouter()


class RoleCatalogItem(BaseModel):
    id: str
    role_key: str
    name: str
    description: str | None
    permission_keys: list[str]


@router.get("", response_model=list[RoleCatalogItem])
def list_roles_catalog(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = user
    roles = db.scalars(
        select(Role).options(joinedload(Role.role_permissions).joinedload(RolePermission.permission)).order_by(Role.name)
    ).unique()
    out: list[RoleCatalogItem] = []
    for r in roles.all():
        keys = sorted(
            {rp.permission.permission_key for rp in r.role_permissions if rp.permission}
        )
        out.append(
            RoleCatalogItem(
                id=str(r.id),
                role_key=r.role_key,
                name=r.name,
                description=r.description,
                permission_keys=keys,
            )
        )
    return out
