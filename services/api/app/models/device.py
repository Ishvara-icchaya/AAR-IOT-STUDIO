import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.device_endpoint import DeviceEndpoint
    from app.models.device_object import DeviceObject
    from app.models.raw_data_object import RawDataObject
    from app.models.site import Site


class Device(Base, TimestampMixin):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    """Inactive: soft off; referential integrity — use Stop/Inactive instead of delete."""
    polling_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    """Stop/restart polling toggles this field."""

    customer: Mapped["Customer"] = relationship(back_populates="devices")
    site: Mapped["Site"] = relationship(back_populates="devices")
    endpoint: Mapped["DeviceEndpoint | None"] = relationship(
        back_populates="device", uselist=False, cascade="all, delete-orphan"
    )
    device_object: Mapped["DeviceObject | None"] = relationship(
        back_populates="device", uselist=False, cascade="all, delete-orphan"
    )
    raw_objects: Mapped[list["RawDataObject"]] = relationship(back_populates="device")
