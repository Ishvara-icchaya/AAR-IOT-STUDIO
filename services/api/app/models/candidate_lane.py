"""Candidate-lane read models (Phase 7); parallel to shared latest_device_state."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CandidateLatestDeviceState(Base):
    __tablename__ = "candidate_latest_device_state"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resolved_device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resolved_devices.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    device_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_versions.id", ondelete="CASCADE"), nullable=False
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False
    )
    identity_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    display_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    kpi_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    health_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    location_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    system_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    scrubbed_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scrubbed_events.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CandidateScrubbedEvent(Base):
    __tablename__ = "candidate_scrubbed_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resolved_device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resolved_devices.id", ondelete="SET NULL"), nullable=True
    )
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class CandidateWorkflowResult(Base):
    __tablename__ = "candidate_workflow_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workflows.id", ondelete="SET NULL"), nullable=True
    )
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
