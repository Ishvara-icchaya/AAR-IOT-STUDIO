import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.device import Device
    from app.models.site import Site


class StaticIngestion(Base, TimestampMixin):
    __tablename__ = "static_ingestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(nullable=True)
    schedule_json: Mapped[dict[str, Any]] = mapped_column(JSONB(), nullable=False, default=dict)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSONB(), nullable=False, default=dict)

    customer: Mapped["Customer"] = relationship()
    site: Mapped["Site"] = relationship()
    device: Mapped["Device | None"] = relationship("Device", foreign_keys=[device_id])
