"""endpoints: identity_managed_by_scrubber — scrubber freeze is source of truth for PK/labels.

Revision ID: 0056_endpoint_identity_managed_by_scrubber
Revises: 0055_device_versions_display_system_key
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0056_endpoint_identity_managed_by_scrubber"
down_revision: Union[str, None] = "0055_device_versions_display_system_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "endpoints",
        sa.Column(
            "identity_managed_by_scrubber",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("endpoints", "identity_managed_by_scrubber")
