"""device_versions: activation artifact staging + frozen operational summary.

Revision ID: 0053_device_version_activation_artifacts
Revises: 0052_version_identity_and_detection_events
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0053_device_version_activation_artifacts"
down_revision: Union[str, None] = "0052_version_identity_and_detection_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device_versions",
        sa.Column("activation_artifacts_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "device_versions",
        sa.Column("frozen_operational_summary_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("device_versions", "frozen_operational_summary_json")
    op.drop_column("device_versions", "activation_artifacts_json")
