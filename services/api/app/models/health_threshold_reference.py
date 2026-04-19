"""Reusable health threshold JSON definitions (customer → optional site → optional device)."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.device import Device
    from app.models.site import Site


class HealthThresholdReference(Base, TimestampMixin):
    __tablename__ = "health_threshold_references"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id", ondelete="CASCADE"), nullable=False
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=True
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=True
    )
    reference_name: Mapped[str] = mapped_column(String(255), nullable=False)
    body_json: Mapped[dict[str, Any]] = mapped_column(JSONB(), nullable=False, default=dict)

    customer: Mapped["Customer"] = relationship()
    site: Mapped["Site | None"] = relationship()
    device: Mapped["Device | None"] = relationship()
