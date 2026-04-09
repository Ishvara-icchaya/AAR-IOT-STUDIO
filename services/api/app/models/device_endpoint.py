import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.device import Device


class DeviceEndpoint(Base, TimestampMixin):
    __tablename__ = "device_endpoints"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    protocol: Mapped[str] = mapped_column(String(64), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    polling_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_verified_at: Mapped[datetime | None] = mapped_column(nullable=True)
    validation_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    validation_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Values: app.core.endpoint_activation.ACTIVATION_STATUS_VALUES
    activation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="configured")
    first_payload_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_payload_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    device: Mapped["Device"] = relationship(back_populates="endpoint")
