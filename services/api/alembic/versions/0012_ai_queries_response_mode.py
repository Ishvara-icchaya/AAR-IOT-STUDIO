"""Add response_mode to ai_queries for Enterprise AI history."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_ai_queries_response_mode"
down_revision = "0011_enterprise_ai_queries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_queries",
        sa.Column("response_mode", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_queries", "response_mode")
