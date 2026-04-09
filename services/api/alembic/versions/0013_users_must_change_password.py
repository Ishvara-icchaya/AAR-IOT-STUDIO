"""Add must_change_password to users (first-login password change)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_must_change_password"
down_revision = "0012_ai_queries_response_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.alter_column("users", "must_change_password", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
