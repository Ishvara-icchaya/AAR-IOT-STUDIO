import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.site import Site
from app.models.user import User
from app.services.permission_service import site_ids_with_permission


def allowed_site_ids_for_user(db: Session, user: User) -> list[uuid.UUID] | None:
    """Sites where the user may perform device read operations (devices.read). None = all tenant sites."""
    return site_ids_with_permission(db, user, "devices.read")


def ensure_site_in_tenant(db: Session, customer_id: uuid.UUID, site_id: uuid.UUID) -> Site | None:
    return db.execute(
        select(Site).where(Site.id == site_id, Site.customer_id == customer_id)
    ).scalar_one_or_none()


def user_may_access_site(user: User, site_id: uuid.UUID, allowed: list[uuid.UUID] | None) -> bool:
    if allowed is None:
        return True
    return site_id in allowed
