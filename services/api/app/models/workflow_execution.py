import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.data_object import DataObject
    from app.models.workflow import Workflow
    from app.models.workflow_node_output import WorkflowNodeOutput
    from app.models.workflow_result_object import WorkflowResultObject


class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workflow_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False
    )
    trigger_type: Mapped[str] = mapped_column(String(64), nullable=False)
    input_data_object_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("data_objects.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    node_outputs_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    workflow: Mapped["Workflow"] = relationship(back_populates="executions")
    input_data_object: Mapped["DataObject | None"] = relationship()
    node_outputs: Mapped[list["WorkflowNodeOutput"]] = relationship(
        back_populates="execution", cascade="all, delete-orphan"
    )
    result_objects: Mapped[list["WorkflowResultObject"]] = relationship(
        back_populates="execution", cascade="all, delete-orphan"
    )
