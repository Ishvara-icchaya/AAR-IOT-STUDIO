"""V2 ingest endpoint (logical stream / integration surface per site)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Endpoint(Base, TimestampMixin):
    __tablename__ = "endpoints"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False
    )
    endpoint_name: Mapped[str] = mapped_column(String(255), nullable=False)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    object_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lifecycle_status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    primary_device_key_fields: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    device_label_fields: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    location_fields: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(JSONB, nullable=True)
    auth_config: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    sample_payload: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(JSONB, nullable=True)
    sample_ingested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    device_endpoint_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_endpoints.id", ondelete="SET NULL"), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
