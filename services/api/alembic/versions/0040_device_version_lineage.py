"""Persist device version lineage rows + optional KPI snapshots.

Revision ID: 0040_device_version_lineage
Revises: 0039_workspace_messages
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0040_device_version_lineage"
down_revision: Union[str, None] = "0039_workspace_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_version_lineage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_label", sa.String(length=64), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trigger_code", sa.String(length=64), nullable=False),
        sa.Column("superseded_by_label", sa.String(length=64), nullable=True),
        sa.Column("ota_external_ref", sa.String(length=255), nullable=True),
        sa.Column("kpi_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index("ix_device_version_lineage_device_recorded", "device_version_lineage", ["device_id", "recorded_at"])
    op.create_index("ix_device_version_lineage_device_id", "device_version_lineage", ["device_id"])

    # Bootstrap one row per device (current declared version).
    op.execute(
        text(
            """
            INSERT INTO device_version_lineage (
                id, device_id, version_label, recorded_at, trigger_code,
                superseded_by_label, ota_external_ref, kpi_snapshot, metadata
            )
            SELECT
                gen_random_uuid(),
                d.id,
                COALESCE(NULLIF(btrim(d.device_version), ''), '1'),
                COALESCE(d.updated_at, d.created_at),
                'bootstrap',
                NULL,
                NULL,
                NULL,
                jsonb_build_object(
                    'version_status', d.version_status,
                    'firmware_version', d.firmware_version,
                    'firmware_channel', d.firmware_channel,
                    'ota_supported', d.ota_supported,
                    'rollback_supported', d.rollback_supported
                )
            FROM devices d
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_device_version_lineage_device_id", table_name="device_version_lineage")
    op.drop_index("ix_device_version_lineage_device_recorded", table_name="device_version_lineage")
    op.drop_table("device_version_lineage")
