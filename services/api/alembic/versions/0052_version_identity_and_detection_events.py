"""Endpoint version_identity JSONB, version_detection_events, device_versions provenance.

Revision ID: 0052_version_identity_and_detection_events
Revises: 0051_alerts_category_audit_check
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0052_version_identity_and_detection_events"
down_revision: Union[str, None] = "0051_alerts_category_audit_check"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("endpoints", sa.Column("version_identity", postgresql.JSONB(astext_type=sa.Text()), nullable=True))

    op.create_table(
        "version_detection_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
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
            nullable=False,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "endpoint_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("endpoints.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "resolved_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resolved_devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("fingerprint", sa.String(length=128), nullable=False),
        sa.Column("value_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_version_detection_events_device_id", "version_detection_events", ["device_id"])
    op.create_index("ix_version_detection_events_detected_at", "version_detection_events", ["detected_at"])
    op.create_index(
        "ix_version_detection_events_resolved_device_id",
        "version_detection_events",
        ["resolved_device_id"],
    )

    op.add_column(
        "device_versions",
        sa.Column("identity_fingerprint", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "device_versions",
        sa.Column("software_version", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "device_versions",
        sa.Column(
            "created_from_detection_event_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_device_versions_created_from_detection_event",
        "device_versions",
        "version_detection_events",
        ["created_from_detection_event_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        """
        CREATE UNIQUE INDEX uq_device_versions_one_active_per_resolved_device
        ON device_versions (resolved_device_id)
        WHERE status = 'active' AND resolved_device_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_device_versions_one_active_per_resolved_device")
    op.drop_constraint("fk_device_versions_created_from_detection_event", "device_versions", type_="foreignkey")
    op.drop_column("device_versions", "created_from_detection_event_id")
    op.drop_column("device_versions", "software_version")
    op.drop_column("device_versions", "identity_fingerprint")
    op.drop_index("ix_version_detection_events_resolved_device_id", table_name="version_detection_events")
    op.drop_index("ix_version_detection_events_detected_at", table_name="version_detection_events")
    op.drop_index("ix_version_detection_events_device_id", table_name="version_detection_events")
    op.drop_table("version_detection_events")
    op.drop_column("endpoints", "version_identity")
