import uuid
from typing import TYPE_CHECKING, Any

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.data_object_detail import DataObjectDetail
    from app.models.device import Device
    from app.models.raw_data_object import RawDataObject
    from app.models.site import Site


class DataObject(Base, TimestampMixin):
    __tablename__ = "data_objects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
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
    raw_data_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("raw_data_objects.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Data object")
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    kpi_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    health_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    health_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    health_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    scrubber_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    has_gps: Mapped[bool] = mapped_column(nullable=False, default=False)
    has_kpi: Mapped[bool] = mapped_column(nullable=False, default=False)
    has_health: Mapped[bool] = mapped_column(nullable=False, default=False)
    has_timeseries: Mapped[bool] = mapped_column(nullable=False, default=False)
    lifecycle_status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    latest_detail_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("data_object_details.id", ondelete="SET NULL"), nullable=True
    )
    latest_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ai_projection: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    device: Mapped["Device"] = relationship()
    site: Mapped["Site"] = relationship()
    raw_object: Mapped["RawDataObject | None"] = relationship()
    details: Mapped[list["DataObjectDetail"]] = relationship(
        "DataObjectDetail",
        back_populates="data_object",
        foreign_keys="DataObjectDetail.data_object_id",
        cascade="all, delete-orphan",
        overlaps="latest_detail",
    )
    latest_detail: Mapped["DataObjectDetail | None"] = relationship(
        "DataObjectDetail",
        foreign_keys=[latest_detail_id],
        post_update=True,
        overlaps="details",
    )
