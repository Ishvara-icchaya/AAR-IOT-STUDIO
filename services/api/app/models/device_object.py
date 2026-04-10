import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.device import Device


class DeviceObject(Base, TimestampMixin):
    """Maps to device_object + mapping.scrubberStudio (runtime truth for scrubber)."""

    __tablename__ = "device_objects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    mapping: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    operational_status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")

    device: Mapped["Device"] = relationship(back_populates="device_object")
