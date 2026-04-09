"""Optional ingest_metadata JSONB on raw_data_objects (source identity + endpoint id)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Keep revision id <= 32 chars (alembic_version.version_num is VARCHAR(32)).
revision = "0018_raw_ingest_metadata"
down_revision = "0017_device_endpoint_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "raw_data_objects",
        sa.Column("ingest_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("raw_data_objects", "ingest_metadata")
