"""Latest read model per resolved device + object_name (current truth)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class LatestDeviceState(Base):
    __tablename__ = "latest_device_state"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False
    )
    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("endpoints.id", ondelete="CASCADE"), nullable=False
    )
    resolved_device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resolved_devices.id", ondelete="CASCADE"), nullable=False
    )
    object_name: Mapped[str] = mapped_column(String(255), nullable=False)
    last_event_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lifecycle_status: Mapped[str] = mapped_column(String(64), nullable=False, default="active")
    health_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    identity_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    display_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    kpi_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    health_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    location_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    system_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    scrubbed_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scrubbed_events.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    endpoint = relationship("Endpoint")
    resolved_device = relationship("ResolvedDevice")
    scrubbed_event = relationship("ScrubbedEvent")
