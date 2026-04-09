import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import Double, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.workflow import Workflow


class WorkflowNode(Base, TimestampMixin):
    __tablename__ = "workflow_nodes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False
    )
    node_type: Mapped[str] = mapped_column(String(64), nullable=False)
    node_name: Mapped[str] = mapped_column(String(255), nullable=False)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    position_x: Mapped[float] = mapped_column(Double, nullable=False, default=0.0)
    position_y: Mapped[float] = mapped_column(Double, nullable=False, default=0.0)

    workflow: Mapped["Workflow"] = relationship(back_populates="nodes")
