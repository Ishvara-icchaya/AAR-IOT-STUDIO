import uuid
from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.site import Site
    from app.models.user import User


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    sites: Mapped[list["Site"]] = relationship(back_populates="customer")
    users: Mapped[list["User"]] = relationship(back_populates="customer")
    devices: Mapped[list["Device"]] = relationship(back_populates="customer")
