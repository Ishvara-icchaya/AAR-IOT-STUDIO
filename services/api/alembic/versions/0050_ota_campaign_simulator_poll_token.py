"""OTA campaign public simulator poll token (minted at launch).

Revision ID: 0050_ota_campaign_simulator_poll_token
Revises: 0049_ota_executor_artifacts
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0050_ota_campaign_simulator_poll_token"
down_revision: Union[str, None] = "0049_ota_executor_artifacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ota_campaigns",
        sa.Column("simulator_poll_token", sa.String(length=96), nullable=True),
    )
    op.create_index(
        "ix_ota_campaigns_simulator_poll_token",
        "ota_campaigns",
        ["simulator_poll_token"],
        unique=True,
        postgresql_where=sa.text("simulator_poll_token IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_ota_campaigns_simulator_poll_token", table_name="ota_campaigns")
    op.drop_column("ota_campaigns", "simulator_poll_token")
