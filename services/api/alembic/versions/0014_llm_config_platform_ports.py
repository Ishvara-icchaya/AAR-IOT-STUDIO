"""LLM admin config and platform ports (per customer)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0014_llm_ports_admin"
down_revision = "0013_must_change_password"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_config",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("model_name", sa.String(length=128), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("max_rows", sa.Integer(), nullable=False),
        sa.Column("max_prompt_chars", sa.Integer(), nullable=False),
        sa.Column("query_timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("rate_limit_per_min", sa.Integer(), nullable=False),
        sa.Column("enable_llm", sa.Boolean(), nullable=False),
        sa.Column("enable_suggestions", sa.Boolean(), nullable=False),
        sa.Column("enable_raw_debug", sa.Boolean(), nullable=False),
        sa.Column("llm_failure_threshold", sa.Integer(), nullable=False),
        sa.Column("llm_cooldown_seconds", sa.Integer(), nullable=False),
        sa.Column("pipeline_failure_threshold", sa.Integer(), nullable=False),
        sa.Column("pipeline_cooldown_seconds", sa.Integer(), nullable=False),
        sa.Column("summary_prompt", sa.Text(), nullable=True),
        sa.Column("incident_prompt", sa.Text(), nullable=True),
        sa.Column("trend_prompt", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("customer_id"),
    )

    op.create_table(
        "platform_ports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_name", sa.String(length=64), nullable=False),
        sa.Column("protocol", sa.String(length=16), nullable=False),
        sa.Column("host", sa.String(length=128), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("customer_id", "service_name", name="uq_platform_ports_customer_service"),
    )

    op.create_table(
        "platform_port_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("default_rest_publish_host", sa.String(length=128), nullable=True),
        sa.Column("default_rest_publish_port", sa.Integer(), nullable=True),
        sa.Column("default_mqtt_publish_host", sa.String(length=128), nullable=True),
        sa.Column("default_mqtt_publish_port", sa.Integer(), nullable=True),
        sa.Column("allow_external_access", sa.Boolean(), nullable=False),
        sa.Column("restrict_to_localhost", sa.Boolean(), nullable=False),
        sa.Column("enable_tls", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("customer_id"),
    )


def downgrade() -> None:
    op.drop_table("platform_port_settings")
    op.drop_table("platform_ports")
    op.drop_table("llm_config")
