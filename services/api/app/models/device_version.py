"""Immutable device version snapshots (Phase 3); authoritative state vs devices.device_version cache."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.resolved_device import ResolvedDevice


class DeviceVersion(Base):
    """One immutable version row per material cut; do not UPDATE rows in place."""

    __tablename__ = "device_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_label: Mapped[str] = mapped_column(String(64), nullable=False)
    resolved_device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resolved_devices.id", ondelete="SET NULL"), nullable=True
    )
    previous_device_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_versions.id", ondelete="SET NULL"), nullable=True
    )
    firmware_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    hardware_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    config_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    endpoint_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scrubber_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    schema_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    manifest_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    version_source: Mapped[str] = mapped_column(String(32), nullable=False, default="system")
    firmware_channel: Mapped[str] = mapped_column(String(32), nullable=False, default="stable")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deprecated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    routing_lane: Mapped[str] = mapped_column(String(16), nullable=False, default="shared")
    compatibility: Mapped[str | None] = mapped_column(String(32), nullable=True)

    device: Mapped["Device"] = relationship(back_populates="device_version_rows")
    resolved_device: Mapped["ResolvedDevice | None"] = relationship()
