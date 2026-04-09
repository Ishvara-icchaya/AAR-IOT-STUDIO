"""device_endpoints lifecycle + last_error; migrate socket -> websocket."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_device_endpoint_lifecycle"
down_revision = "0016_device_endpoint_validation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device_endpoints",
        sa.Column(
            "activation_status",
            sa.String(length=32),
            nullable=False,
            server_default="configured",
        ),
    )
    op.add_column("device_endpoints", sa.Column("first_payload_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("device_endpoints", sa.Column("last_payload_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("device_endpoints", sa.Column("last_error", sa.Text(), nullable=True))

    op.execute(
        """
        UPDATE device_endpoints
        SET protocol = 'websocket'
        WHERE protocol = 'socket'
        """
    )

    op.execute(
        """
        UPDATE device_endpoints
        SET activation_status = 'inactive'
        WHERE is_active = false
        """
    )

    op.alter_column("device_endpoints", "activation_status", server_default=None)


def downgrade() -> None:
    op.drop_column("device_endpoints", "last_error")
    op.drop_column("device_endpoints", "last_payload_at")
    op.drop_column("device_endpoints", "first_payload_at")
    op.drop_column("device_endpoints", "activation_status")
