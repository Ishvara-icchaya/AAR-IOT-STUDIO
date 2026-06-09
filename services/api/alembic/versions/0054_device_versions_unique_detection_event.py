"""Unique index: one device_versions row per version_detection_events id (async consumer idempotency).

Revision ID: 0054_device_versions_unique_detection_event
Revises: 0053_device_version_activation_artifacts
"""

from __future__ import annotations

from typing import Union

from alembic import op

revision: str = "0054_device_versions_unique_detection_event"
down_revision: Union[str, None] = "0053_device_version_activation_artifacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX ux_device_versions_detection_event
        ON device_versions (created_from_detection_event_id)
        WHERE created_from_detection_event_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_device_versions_detection_event")
