import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import TimestampMixin


class LlmConfig(Base, TimestampMixin):
    __tablename__ = "llm_config"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customers.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)

    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    max_rows: Mapped[int] = mapped_column(Integer, nullable=False)
    max_prompt_chars: Mapped[int] = mapped_column(Integer, nullable=False)
    query_timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    rate_limit_per_min: Mapped[int] = mapped_column(Integer, nullable=False)

    enable_llm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enable_suggestions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enable_raw_debug: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    llm_failure_threshold: Mapped[int] = mapped_column(Integer, nullable=False)
    llm_cooldown_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    pipeline_failure_threshold: Mapped[int] = mapped_column(Integer, nullable=False)
    pipeline_cooldown_seconds: Mapped[int] = mapped_column(Integer, nullable=False)

    summary_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    incident_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    trend_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    customer = relationship("Customer", backref="llm_config_row")
