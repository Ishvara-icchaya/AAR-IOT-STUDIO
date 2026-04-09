"""device_endpoints: validation outcome columns (connectivity + payload summary)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_device_endpoint_validation"
down_revision = "0015_mqtt_ingest_ports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device_endpoints",
        sa.Column("validation_status", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "device_endpoints",
        sa.Column("validation_detail", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("device_endpoints", "validation_detail")
    op.drop_column("device_endpoints", "validation_status")
