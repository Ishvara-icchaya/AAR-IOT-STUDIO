"""Persist data_object feature flags (gps/kpi/health/timeseries)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_data_object_flags"
down_revision = "0018_raw_ingest_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_objects",
        sa.Column("has_gps", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "data_objects",
        sa.Column("has_kpi", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "data_objects",
        sa.Column("has_health", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "data_objects",
        sa.Column("has_timeseries", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.alter_column("data_objects", "has_gps", server_default=None)
    op.alter_column("data_objects", "has_kpi", server_default=None)
    op.alter_column("data_objects", "has_health", server_default=None)
    op.alter_column("data_objects", "has_timeseries", server_default=None)


def downgrade() -> None:
    op.drop_column("data_objects", "has_timeseries")
    op.drop_column("data_objects", "has_health")
    op.drop_column("data_objects", "has_kpi")
    op.drop_column("data_objects", "has_gps")
