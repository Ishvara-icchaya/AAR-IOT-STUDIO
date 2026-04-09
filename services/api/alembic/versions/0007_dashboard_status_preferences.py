"""Dashboard status, description, user primary preference (layout JSON in dashboards.layout).

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dashboards", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "dashboards",
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default="draft",
        ),
    )
    op.execute(
        """
        UPDATE dashboards
        SET status = CASE WHEN is_frozen IS TRUE THEN 'frozen' ELSE 'draft' END
        """
    )
    op.drop_column("dashboards", "is_frozen")

    op.create_table(
        "dashboard_user_preferences",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("primary_dashboard_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["primary_dashboard_id"], ["dashboards.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("dashboard_user_preferences")
    op.add_column(
        "dashboards",
        sa.Column("is_frozen", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.execute("UPDATE dashboards SET is_frozen = (status = 'frozen')")
    op.drop_column("dashboards", "status")
    op.drop_column("dashboards", "description")
