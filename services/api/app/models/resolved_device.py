"""Resolved device identity under a v2 endpoint (PK hash within object_name)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class ResolvedDevice(Base, TimestampMixin):
    __tablename__ = "resolved_devices"

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
    object_name: Mapped[str] = mapped_column(String(255), nullable=False)
    primary_key_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    primary_key_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    device_label: Mapped[str | None] = mapped_column(String(512), nullable=True)
    device_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lifecycle_status: Mapped[str] = mapped_column(String(64), nullable=False, default="active")
    health_status: Mapped[str | None] = mapped_column(String(32), nullable=True)

    endpoint = relationship("Endpoint")
