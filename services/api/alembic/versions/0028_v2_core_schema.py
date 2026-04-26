"""v2: endpoints, resolved_devices, scrubbed_events, latest_device_state, ingest_quarantine; raw archive FK.

Revision ID: 0028_v2_core_schema (≤32 chars for alembic_version.version_num)
Revises: 0027_data_object_ai_projection
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0028_v2_core_schema"
down_revision = "0027_data_object_ai_projection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "endpoints",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("endpoint_name", sa.String(length=255), nullable=False),
        sa.Column("protocol", sa.String(length=32), nullable=False),
        sa.Column("object_name", sa.String(length=255), nullable=False),
        sa.Column("primary_device_key_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("device_label_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("location_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("auth_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_endpoints_customer_id", "endpoints", ["customer_id"])
    op.create_index("ix_endpoints_site_id", "endpoints", ["site_id"])
    op.create_index("ix_endpoints_site_enabled", "endpoints", ["site_id", "enabled"])

    op.create_table(
        "resolved_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False),
        sa.Column(
            "endpoint_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("endpoints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_name", sa.String(length=255), nullable=False),
        sa.Column("primary_key_hash", sa.String(length=128), nullable=False),
        sa.Column("primary_key_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("device_label", sa.String(length=512), nullable=True),
        sa.Column("device_type", sa.String(length=128), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lifecycle_status", sa.String(length=64), nullable=False, server_default=sa.text("'active'")),
        sa.Column("health_status", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint(
            "customer_id",
            "site_id",
            "endpoint_id",
            "object_name",
            "primary_key_hash",
            name="uq_resolved_devices_identity",
        ),
    )
    op.create_index("ix_resolved_devices_endpoint", "resolved_devices", ["endpoint_id"])
    op.create_index("ix_resolved_devices_customer_site", "resolved_devices", ["customer_id", "site_id"])

    op.create_table(
        "scrubbed_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False),
        sa.Column(
            "endpoint_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("endpoints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resolved_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resolved_devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_name", sa.String(length=255), nullable=False),
        sa.Column("event_ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("identity_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("display_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("kpi_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("health_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("location_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("payload_ref", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_scrubbed_events_history",
        "scrubbed_events",
        ["customer_id", "site_id", "endpoint_id", "resolved_device_id", "object_name", "event_ts"],
        postgresql_ops={"event_ts": "DESC"},
    )
    op.create_index("ix_scrubbed_events_resolved_device", "scrubbed_events", ["resolved_device_id"])

    op.create_table(
        "latest_device_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="RESTRICT"), nullable=False),
        sa.Column(
            "endpoint_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("endpoints.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resolved_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resolved_devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("object_name", sa.String(length=255), nullable=False),
        sa.Column("last_event_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_ingested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lifecycle_status", sa.String(length=64), nullable=False, server_default=sa.text("'active'")),
        sa.Column("health_status", sa.String(length=32), nullable=True),
        sa.Column("identity_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("display_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("kpi_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("health_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("location_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "scrubbed_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("scrubbed_events.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint(
            "customer_id",
            "site_id",
            "endpoint_id",
            "resolved_device_id",
            "object_name",
            name="uq_latest_device_state_row",
        ),
    )
    op.create_index("ix_latest_device_state_endpoint", "latest_device_state", ["endpoint_id"])
    op.create_index("ix_latest_device_state_resolved", "latest_device_state", ["resolved_device_id"])

    op.create_table(
        "ingest_quarantine",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "endpoint_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("endpoints.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reason_code", sa.String(length=64), nullable=False),
        sa.Column("transport", sa.String(length=64), nullable=False),
        sa.Column("attempted_binding_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("attempted_payload_identity_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("payload_ref", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("trace_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_quarantine_expiry", "ingest_quarantine", ["expires_at"])
    op.create_index("ix_ingest_quarantine_customer_created", "ingest_quarantine", ["customer_id", "created_at"])

    op.add_column(
        "raw_data_objects",
        sa.Column(
            "registered_endpoint_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("endpoints.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_raw_data_objects_registered_endpoint", "raw_data_objects", ["registered_endpoint_id"])


def downgrade() -> None:
    op.drop_index("ix_raw_data_objects_registered_endpoint", table_name="raw_data_objects")
    op.drop_column("raw_data_objects", "registered_endpoint_id")

    op.drop_index("ix_ingest_quarantine_customer_created", table_name="ingest_quarantine")
    op.drop_index("idx_quarantine_expiry", table_name="ingest_quarantine")
    op.drop_table("ingest_quarantine")

    op.drop_index("ix_latest_device_state_resolved", table_name="latest_device_state")
    op.drop_index("ix_latest_device_state_endpoint", table_name="latest_device_state")
    op.drop_table("latest_device_state")

    op.drop_index("ix_scrubbed_events_resolved_device", table_name="scrubbed_events")
    op.drop_index("ix_scrubbed_events_history", table_name="scrubbed_events")
    op.drop_table("scrubbed_events")

    op.drop_index("ix_resolved_devices_customer_site", table_name="resolved_devices")
    op.drop_index("ix_resolved_devices_endpoint", table_name="resolved_devices")
    op.drop_table("resolved_devices")

    op.drop_index("ix_endpoints_site_enabled", table_name="endpoints")
    op.drop_index("ix_endpoints_site_id", table_name="endpoints")
    op.drop_index("ix_endpoints_customer_id", table_name="endpoints")
    op.drop_table("endpoints")
