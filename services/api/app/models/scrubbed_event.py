"""Historical scrubbed event row (bounded history for tables / replay)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ScrubbedEvent(Base):
    __tablename__ = "scrubbed_events"

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
    event_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    identity_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    display_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    kpi_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    health_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    location_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    payload_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    endpoint = relationship("Endpoint")
    resolved_device = relationship("ResolvedDevice")
