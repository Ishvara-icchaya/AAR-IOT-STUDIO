import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.device_endpoint import DeviceEndpoint
    from app.models.device_object import DeviceObject
    from app.models.device_version import DeviceVersion
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
    operational_status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_liveness_state: Mapped[str] = mapped_column(
        String(64), nullable=False, default="waiting_for_first_payload"
    )
    last_state_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_alerted_state: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expected_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    late_threshold_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    offline_threshold_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=300)

    # Declared firmware / OTA readiness (v8 Manage Devices; not protocol identity).
    firmware_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    firmware_channel: Mapped[str] = mapped_column(String(32), nullable=False, default="stable")
    ota_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rollback_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    device_version: Mapped[str] = mapped_column(String(64), nullable=False, default="1")
    version_status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")

    customer: Mapped["Customer"] = relationship(back_populates="devices")
    site: Mapped["Site"] = relationship(back_populates="devices")
    endpoint: Mapped["DeviceEndpoint | None"] = relationship(
        back_populates="device", uselist=False, cascade="all, delete-orphan"
    )
    device_object: Mapped["DeviceObject | None"] = relationship(
        back_populates="device", uselist=False, cascade="all, delete-orphan"
    )
    raw_objects: Mapped[list["RawDataObject"]] = relationship(back_populates="device")
    device_version_rows: Mapped[list["DeviceVersion"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )
