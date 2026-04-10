"""Static ingestions (JSON payloads + schedule metadata for workflows)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0020_static_ingestions"
down_revision = "0019_data_object_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "static_ingestions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "customer_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("schedule_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("payload_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("customer_id", "site_id", "name", name="uq_static_ingestion_customer_site_name"),
    )
    op.create_index("ix_static_ingestions_site_id", "static_ingestions", ["site_id"])


def downgrade() -> None:
    op.drop_index("ix_static_ingestions_site_id", table_name="static_ingestions")
    op.drop_table("static_ingestions")
