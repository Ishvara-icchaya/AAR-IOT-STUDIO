"""Health threshold reference definitions (customer/site/device scoped)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0025_health_threshold_references"
down_revision = "0024_device_liveness_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "health_threshold_references",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "customer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("reference_name", sa.String(255), nullable=False),
        sa.Column("body_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_health_threshold_refs_customer",
        "health_threshold_references",
        ["customer_id"],
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_health_threshold_ref_scope ON health_threshold_references (
            customer_id,
            reference_name,
            coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid),
            coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_health_threshold_ref_scope")
    op.drop_index("ix_health_threshold_refs_customer", table_name="health_threshold_references")
    op.drop_table("health_threshold_references")
