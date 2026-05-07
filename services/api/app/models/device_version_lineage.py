import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DeviceVersionLineage(Base):
    """Immutable version cut for a device (timeline + optional footprint KPI snapshot at record time)."""

    __tablename__ = "device_version_lineage"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_label: Mapped[str] = mapped_column(String(64), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    trigger_code: Mapped[str] = mapped_column(String(64), nullable=False)
    superseded_by_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ota_external_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kpi_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)

    event_type: Mapped[str] = mapped_column(String(64), nullable=False, default="metadata_updated")
    source_type: Mapped[str | None] = mapped_column(String(32), nullable=True, default="system")
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True, default="completed")
    previous_device_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_versions.id", ondelete="SET NULL"), nullable=True
    )
    target_device_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_versions.id", ondelete="SET NULL"), nullable=True
    )
    ota_campaign_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
