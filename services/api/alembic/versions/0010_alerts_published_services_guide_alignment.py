"""Align alerts + published_services with Published Services / Alerts implementation guide."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_alerts_psvc_guide"
down_revision = "0009_alert_severity_normalize"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE alerts SET category = 'system'
        WHERE category IS NULL OR trim(category) = ''
           OR lower(trim(category)) NOT IN (
             'ingest','scrubber','workflow','publish','dashboard',
             'monitoring','ai','device_health','system'
           )
        """
    )
    op.execute("UPDATE alerts SET message = '' WHERE message IS NULL")

    op.add_column(
        "alerts",
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute("UPDATE alerts SET acknowledged = (acknowledged_at IS NOT NULL)")
    op.alter_column("alerts", "acknowledged", server_default=None)

    op.alter_column(
        "alerts",
        "category",
        nullable=False,
        server_default=sa.text("'system'"),
    )
    op.alter_column(
        "alerts",
        "message",
        nullable=False,
        server_default=sa.text("''"),
    )

    op.execute("UPDATE alerts SET title = left(title, 255) WHERE length(title) > 255")
    op.alter_column(
        "alerts",
        "title",
        existing_type=sa.String(512),
        type_=sa.String(255),
        existing_nullable=False,
    )
    op.alter_column(
        "alerts",
        "severity",
        existing_type=sa.String(32),
        type_=sa.String(16),
        existing_nullable=False,
    )

    op.create_check_constraint(
        "ck_alerts_category",
        "alerts",
        "category IN ("
        "'ingest','scrubber','workflow','publish','dashboard',"
        "'monitoring','ai','device_health','system')",
    )
    op.create_check_constraint(
        "ck_alerts_severity",
        "alerts",
        "severity IN ('info','warning','critical')",
    )

    op.create_index(
        "ix_alerts_customer_site_created",
        "alerts",
        ["customer_id", "site_id", "created_at"],
        postgresql_ops={"created_at": "DESC"},
    )
    op.create_index("ix_alerts_acknowledged", "alerts", ["acknowledged"])
    op.create_index("ix_alerts_severity", "alerts", ["severity"])
    op.create_index("ix_alerts_category", "alerts", ["category"])

    op.drop_constraint("published_services_site_id_fkey", "published_services", type_="foreignkey")
    op.create_foreign_key(
        "published_services_site_id_fkey",
        "published_services",
        "sites",
        ["site_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_index("ix_published_services_customer", table_name="published_services")
    op.drop_index("ix_published_services_site", table_name="published_services")
    op.create_index(
        "ix_published_services_customer_site",
        "published_services",
        ["customer_id", "site_id"],
    )
    op.create_index("ix_published_services_status", "published_services", ["status"])

    op.drop_index("ix_pub_delivery_logs_service", table_name="published_service_delivery_logs")
    op.create_index(
        "ix_pub_delivery_logs_service_time",
        "published_service_delivery_logs",
        ["published_service_id", "published_at"],
        postgresql_ops={"published_at": "DESC"},
    )

    op.alter_column("alerts", "category", server_default=None)
    op.alter_column("alerts", "message", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_pub_delivery_logs_service_time", table_name="published_service_delivery_logs")
    op.create_index(
        "ix_pub_delivery_logs_service",
        "published_service_delivery_logs",
        ["published_service_id"],
    )

    op.drop_index("ix_published_services_status", table_name="published_services")
    op.drop_index("ix_published_services_customer_site", table_name="published_services")
    op.create_index("ix_published_services_customer", "published_services", ["customer_id"])
    op.create_index("ix_published_services_site", "published_services", ["site_id"])

    op.drop_constraint("published_services_site_id_fkey", "published_services", type_="foreignkey")
    op.create_foreign_key(
        "published_services_site_id_fkey",
        "published_services",
        "sites",
        ["site_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.drop_index("ix_alerts_category", table_name="alerts")
    op.drop_index("ix_alerts_severity", table_name="alerts")
    op.drop_index("ix_alerts_acknowledged", table_name="alerts")
    op.drop_index("ix_alerts_customer_site_created", table_name="alerts")
    op.drop_constraint("ck_alerts_severity", "alerts", type_="check")
    op.drop_constraint("ck_alerts_category", "alerts", type_="check")

    op.alter_column(
        "alerts",
        "severity",
        existing_type=sa.String(16),
        type_=sa.String(32),
        existing_nullable=False,
    )
    op.alter_column(
        "alerts",
        "title",
        existing_type=sa.String(255),
        type_=sa.String(512),
        existing_nullable=False,
    )

    op.drop_column("alerts", "acknowledged")
    op.alter_column("alerts", "message", nullable=True, server_default=None)
    op.alter_column("alerts", "category", nullable=True, server_default=None)
