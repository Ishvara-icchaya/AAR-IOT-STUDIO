"""latest_device_state + candidate_latest_device_state: system_json for worker-only flags (e.g. version_identity).

Revision ID: 0048_latest_device_state_system_json
Revises: 0047_device_operator_simulation_run
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0048_latest_device_state_system_json"
down_revision: Union[str, None] = "0047_device_operator_simulation_run"
branch_labels = None
depends_on = None


def upgrade() -> None:
    jsonb = postgresql.JSONB(astext_type=sa.Text())
    default = sa.text("'{}'::jsonb")
    op.add_column(
        "latest_device_state",
        sa.Column("system_json", jsonb, nullable=False, server_default=default),
    )
    op.add_column(
        "candidate_latest_device_state",
        sa.Column("system_json", jsonb, nullable=False, server_default=default),
    )


def downgrade() -> None:
    op.drop_column("candidate_latest_device_state", "system_json")
    op.drop_column("latest_device_state", "system_json")
