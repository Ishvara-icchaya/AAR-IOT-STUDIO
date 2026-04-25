"""Optional device scope for static ingestions (per-device payloads, site unchanged)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026_static_ingestion_device_id"
down_revision = "0025_health_threshold_references"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_static_ingestion_customer_site_name", "static_ingestions", type_="unique")
    op.add_column(
        "static_ingestions",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_static_ingestions_device_id",
        "static_ingestions",
        "devices",
        ["device_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_static_ingestions_device_id", "static_ingestions", ["device_id"])
    op.execute(
        """
        CREATE UNIQUE INDEX uq_static_ingestion_site_level_name
        ON static_ingestions (customer_id, site_id, name)
        WHERE device_id IS NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_static_ingestion_device_level_name
        ON static_ingestions (customer_id, device_id, name)
        WHERE device_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_static_ingestion_device_level_name")
    op.execute("DROP INDEX IF EXISTS uq_static_ingestion_site_level_name")
    op.drop_index("ix_static_ingestions_device_id", table_name="static_ingestions")
    op.drop_constraint("fk_static_ingestions_device_id", "static_ingestions", type_="foreignkey")
    op.drop_column("static_ingestions", "device_id")
    op.create_unique_constraint(
        "uq_static_ingestion_customer_site_name",
        "static_ingestions",
        ["customer_id", "site_id", "name"],
    )
