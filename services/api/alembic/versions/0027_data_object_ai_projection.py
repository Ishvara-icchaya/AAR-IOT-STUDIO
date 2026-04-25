"""data_objects: ai_projection JSONB for role-based Enterprise AI evidence."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0027_data_object_ai_projection"
down_revision = "0026_static_ingestion_device_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_objects",
        sa.Column("ai_projection", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("data_objects", "ai_projection")
