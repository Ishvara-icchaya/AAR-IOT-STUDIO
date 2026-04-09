import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.device import Device


class RawDataObject(Base):
    __tablename__ = "raw_data_objects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="RESTRICT"), nullable=False
    )
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    captured_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)

    ingest_status: Mapped[str] = mapped_column(String(32), nullable=False, default="archived")
    verified_at: Mapped[datetime | None] = mapped_column(nullable=True)
    verify_status: Mapped[str] = mapped_column(String(32), nullable=False, default="never")
    verify_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    protocol_source: Mapped[str | None] = mapped_column(String(32), nullable=True)

    ingest_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    device: Mapped["Device"] = relationship(back_populates="raw_objects")
