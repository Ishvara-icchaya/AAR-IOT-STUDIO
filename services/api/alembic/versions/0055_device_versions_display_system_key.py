"""device_versions: display_version_label + system_version_key (governed UX vs internal key).

Revision ID: 0055_device_versions_display_system_key
Revises: 0054_device_versions_unique_detection_event
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0055_device_versions_display_system_key"
down_revision: Union[str, None] = "0054_device_versions_unique_detection_event"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device_versions",
        sa.Column("display_version_label", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "device_versions",
        sa.Column("system_version_key", sa.String(length=128), nullable=True),
    )
    op.execute(
        """
        UPDATE device_versions
        SET display_version_label = version_label
        WHERE display_version_label IS NULL
        """
    )
    op.execute(
        """
        UPDATE device_versions
        SET system_version_key = version_label
        WHERE system_version_key IS NULL
          AND version_source = 'endpoint_version_identity'
          AND version_label LIKE 'det-%%'
        """
    )
    op.alter_column(
        "device_versions",
        "display_version_label",
        existing_type=sa.String(length=64),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_column("device_versions", "system_version_key")
    op.drop_column("device_versions", "display_version_label")
