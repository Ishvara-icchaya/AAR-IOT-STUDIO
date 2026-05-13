"""device_versions table + generalized lineage columns (Phases 2–3).

Revision ID: 0041_device_versions_and_lineage_events
Revises: 0040b_expand_alembic_ver
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0041_device_versions_and_lineage_events"
down_revision: Union[str, None] = "0040b_expand_alembic_ver"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_label", sa.String(length=64), nullable=False),
        sa.Column(
            "resolved_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resolved_devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "previous_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("firmware_version", sa.String(length=128), nullable=True),
        sa.Column("hardware_version", sa.String(length=128), nullable=True),
        sa.Column("config_version", sa.String(length=64), nullable=True),
        sa.Column("endpoint_version", sa.String(length=64), nullable=True),
        sa.Column("scrubber_version", sa.String(length=64), nullable=True),
        sa.Column("schema_version", sa.String(length=128), nullable=True),
        sa.Column("manifest_hash", sa.String(length=128), nullable=True),
        sa.Column("version_source", sa.String(length=32), nullable=False, server_default="system"),
        sa.Column("firmware_channel", sa.String(length=32), nullable=False, server_default="stable"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deprecated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_device_versions_device_id", "device_versions", ["device_id"])
    op.create_index("ix_device_versions_device_created", "device_versions", ["device_id", "created_at"])

    op.execute(
        text(
            """
            INSERT INTO device_versions (
                id, device_id, version_label, resolved_device_id, previous_device_version_id,
                firmware_version, hardware_version, config_version, endpoint_version, scrubber_version,
                schema_version, manifest_hash, version_source, firmware_channel, status,
                created_at, created_by, activated_at, deprecated_at
            )
            SELECT
                gen_random_uuid(),
                d.id,
                COALESCE(NULLIF(btrim(d.device_version), ''), '1'),
                NULL,
                NULL,
                d.firmware_version,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                'system',
                d.firmware_channel,
                d.version_status,
                COALESCE(d.updated_at, d.created_at),
                NULL,
                COALESCE(d.updated_at, d.created_at),
                NULL
            FROM devices d
            """
        )
    )

    op.add_column(
        "device_version_lineage",
        sa.Column("event_type", sa.String(length=64), nullable=False, server_default="metadata_updated"),
    )
    op.add_column(
        "device_version_lineage",
        sa.Column("source_type", sa.String(length=32), nullable=True, server_default="system"),
    )
    op.add_column("device_version_lineage", sa.Column("source_id", sa.String(length=255), nullable=True))
    op.add_column(
        "device_version_lineage",
        sa.Column("status", sa.String(length=64), nullable=True, server_default="completed"),
    )
    op.add_column(
        "device_version_lineage",
        sa.Column(
            "previous_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "device_version_lineage",
        sa.Column(
            "target_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("device_version_lineage", sa.Column("ota_campaign_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        "device_version_lineage",
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "device_version_lineage",
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.execute(
        text(
            """
            UPDATE device_version_lineage dvl
            SET event_type = CASE dvl.trigger_code
                WHEN 'bootstrap' THEN 'device_registered'
                ELSE 'metadata_updated'
            END
            """
        )
    )

    op.execute(
        text(
            """
            UPDATE device_version_lineage dvl
            SET target_device_version_id = dv.id
            FROM device_versions dv
            WHERE dv.device_id = dvl.device_id
              AND dv.version_label = dvl.version_label
            """
        )
    )

    op.alter_column("device_version_lineage", "event_type", server_default=None)
    op.alter_column("device_version_lineage", "source_type", server_default=None)
    op.alter_column("device_version_lineage", "status", server_default=None)


def downgrade() -> None:
    op.drop_column("device_version_lineage", "created_by")
    op.drop_column("device_version_lineage", "payload_json")
    op.drop_column("device_version_lineage", "ota_campaign_id")
    op.drop_column("device_version_lineage", "target_device_version_id")
    op.drop_column("device_version_lineage", "previous_device_version_id")
    op.drop_column("device_version_lineage", "status")
    op.drop_column("device_version_lineage", "source_id")
    op.drop_column("device_version_lineage", "source_type")
    op.drop_column("device_version_lineage", "event_type")
    op.drop_index("ix_device_versions_device_created", table_name="device_versions")
    op.drop_index("ix_device_versions_device_id", table_name="device_versions")
    op.drop_table("device_versions")
