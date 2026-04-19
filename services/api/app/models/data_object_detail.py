"""Observed facts / history rows for a data object (metadata lives on `data_objects`)."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.data_object import DataObject
    from app.models.raw_data_object import RawDataObject


class DataObjectDetail(Base):
    __tablename__ = "data_object_details"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    data_object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("data_objects.id", ondelete="CASCADE"), nullable=False
    )
    raw_data_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("raw_data_objects.id", ondelete="SET NULL"), nullable=True
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    kpi_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    health_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    health_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    health_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    grouping_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    data_object: Mapped["DataObject"] = relationship(
        "DataObject",
        back_populates="details",
        foreign_keys=[data_object_id],
    )
    raw_object: Mapped["RawDataObject | None"] = relationship()
