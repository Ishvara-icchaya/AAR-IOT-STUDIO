"""Bootstrap default customer + admin user when database is empty."""

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.customer import Customer
from app.models.user import User

log = logging.getLogger(__name__)


def ensure_bootstrap_admin(db: Session) -> None:
    n = db.scalar(select(func.count()).select_from(User))
    if n and n > 0:
        return

    customer = Customer(id=uuid.uuid4(), name="Default customer")
    db.add(customer)
    db.flush()

    admin = User(
        id=uuid.uuid4(),
        customer_id=customer.id,
        email=settings.bootstrap_admin_email.lower().strip(),
        full_name="Bootstrap admin",
        hashed_password=hash_password(settings.bootstrap_admin_password),
        is_active=True,
        is_superuser=True,
        role="admin",
        must_change_password=True,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return
    log.warning(
        "Seeded bootstrap admin email=%s (change BOOTSTRAP_ADMIN_PASSWORD / user password immediately)",
        admin.email,
    )
