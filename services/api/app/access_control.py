import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.site import Site
from app.models.user import User


def allowed_site_ids_for_user(db: Session, user: User) -> list[uuid.UUID] | None:
    """Return None if user may access all sites in the customer; else explicit site id list."""
    if user.is_superuser or user.role == "admin":
        return None
    ids = [link.site_id for link in user.site_links]
    return ids


def ensure_site_in_tenant(db: Session, customer_id: uuid.UUID, site_id: uuid.UUID) -> Site | None:
    return db.execute(
        select(Site).where(Site.id == site_id, Site.customer_id == customer_id)
    ).scalar_one_or_none()


def user_may_access_site(user: User, site_id: uuid.UUID, allowed: list[uuid.UUID] | None) -> bool:
    if allowed is None:
        return True
    return site_id in allowed
