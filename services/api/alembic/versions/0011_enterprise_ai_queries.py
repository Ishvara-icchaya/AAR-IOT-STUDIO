"""Enterprise AI query history and saved queries."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0011_enterprise_ai_queries"
down_revision = "0010_alerts_psvc_guide"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_queries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("customer_id", UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("site_scope_json", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("intent", sa.String(length=64), nullable=False),
        sa.Column("plan_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("answer_text", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("llm_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("degraded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_ai_queries_customer_created", "ai_queries", ["customer_id", "created_at"])
    op.create_index("ix_ai_queries_user_created", "ai_queries", ["user_id", "created_at"])

    op.create_table(
        "ai_saved_queries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("customer_id", UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("default_site_scope_json", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("default_time_range", sa.String(length=64), nullable=False, server_default="last_24_hours"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_ai_saved_queries_user", "ai_saved_queries", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_saved_queries_user", table_name="ai_saved_queries")
    op.drop_table("ai_saved_queries")
    op.drop_index("ix_ai_queries_user_created", table_name="ai_queries")
    op.drop_index("ix_ai_queries_customer_created", table_name="ai_queries")
    op.drop_table("ai_queries")
