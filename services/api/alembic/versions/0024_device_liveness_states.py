"""Device liveness state fields and thresholds.

Revision ID: 0024_device_liveness_states
Revises: 0023_workflow_result_details
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_device_liveness_states"
down_revision: Union[str, None] = "0023_workflow_result_details"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "devices",
        sa.Column(
            "current_liveness_state",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'waiting_for_first_payload'"),
        ),
    )
    op.add_column("devices", sa.Column("last_state_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("last_alerted_state", sa.String(length=64), nullable=True))
    op.add_column(
        "devices",
        sa.Column(
            "expected_interval_seconds",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("60"),
        ),
    )
    op.add_column(
        "devices",
        sa.Column(
            "late_threshold_seconds",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("120"),
        ),
    )
    op.add_column(
        "devices",
        sa.Column(
            "offline_threshold_seconds",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("300"),
        ),
    )
    op.create_index("ix_devices_customer_liveness", "devices", ["customer_id", "current_liveness_state"])
    op.create_index("ix_devices_site_liveness", "devices", ["site_id", "current_liveness_state"])


def downgrade() -> None:
    op.drop_index("ix_devices_site_liveness", table_name="devices")
    op.drop_index("ix_devices_customer_liveness", table_name="devices")
    op.drop_column("devices", "offline_threshold_seconds")
    op.drop_column("devices", "late_threshold_seconds")
    op.drop_column("devices", "expected_interval_seconds")
    op.drop_column("devices", "last_alerted_state")
    op.drop_column("devices", "last_state_changed_at")
    op.drop_column("devices", "current_liveness_state")
    op.drop_column("devices", "last_seen_at")
