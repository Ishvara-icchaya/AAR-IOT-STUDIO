"""Alerts columns + published services phase-1 schema + delivery logs."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008_alerts_pub_p1"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE alerts RENAME COLUMN body TO message")
    op.execute("ALTER TABLE alerts RENAME COLUMN acknowledged_by TO acknowledged_by_user_id")

    op.add_column("alerts", sa.Column("category", sa.String(32), nullable=True))
    op.add_column("alerts", sa.Column("source_component", sa.String(100), nullable=True))
    op.add_column("alerts", sa.Column("source_object_type", sa.String(64), nullable=True))
    op.add_column(
        "alerts",
        sa.Column("source_object_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("alerts", sa.Column("trace_id", sa.String(128), nullable=True))

    op.drop_table("published_services")

    op.create_table(
        "published_services",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_object_name", sa.String(200), nullable=False),
        sa.Column("publish_protocol", sa.String(16), nullable=False),
        sa.Column(
            "target_config_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("last_published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_message", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
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
        sa.CheckConstraint(
            "source_type IN ('data_object', 'result_object')",
            name="ck_published_services_source_type",
        ),
        sa.CheckConstraint(
            "publish_protocol IN ('mqtt', 'rest')",
            name="ck_published_services_publish_protocol",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'stopped', 'failed', 'inactive')",
            name="ck_published_services_status",
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_published_services_customer", "published_services", ["customer_id"])
    op.create_index(
        "ix_published_services_source",
        "published_services",
        ["customer_id", "source_type", "source_object_id"],
    )
    op.create_index("ix_published_services_site", "published_services", ["site_id"])

    op.create_table(
        "published_service_delivery_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("published_service_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("response_code", sa.String(64), nullable=True),
        sa.Column("response_message", sa.Text(), nullable=True),
        sa.Column("trace_id", sa.String(128), nullable=True),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('success', 'failed')",
            name="ck_published_service_delivery_logs_status",
        ),
        sa.ForeignKeyConstraint(
            ["published_service_id"],
            ["published_services.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_pub_delivery_logs_service",
        "published_service_delivery_logs",
        ["published_service_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_pub_delivery_logs_service", table_name="published_service_delivery_logs")
    op.drop_table("published_service_delivery_logs")
    op.drop_index("ix_published_services_site", table_name="published_services")
    op.drop_index("ix_published_services_source", table_name="published_services")
    op.drop_index("ix_published_services_customer", table_name="published_services")
    op.drop_table("published_services")

    op.create_table(
        "published_services",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="inactive"),
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("subscriber_count", sa.Integer(), nullable=False, server_default="0"),
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
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.drop_column("alerts", "trace_id")
    op.drop_column("alerts", "source_object_id")
    op.drop_column("alerts", "source_object_type")
    op.drop_column("alerts", "source_component")
    op.drop_column("alerts", "category")
    op.execute("ALTER TABLE alerts RENAME COLUMN acknowledged_by_user_id TO acknowledged_by")
    op.execute("ALTER TABLE alerts RENAME COLUMN message TO body")
