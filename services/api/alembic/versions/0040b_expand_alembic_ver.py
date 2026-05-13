"""Widen alembic_version.version_num — later revision ids exceed VARCHAR(32).

Revision ID: 0040b_expand_alembic_ver (must stay ≤32 chars; see 0018/0021/0023/0028)
Revises: 0040_device_version_lineage
Next: 0041_device_versions_and_lineage_events
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0040b_expand_alembic_ver"
down_revision: Union[str, None] = "0040_device_version_lineage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=255),
        existing_nullable=False,
    )


def downgrade() -> None:
    """May fail if any stored revision id is longer than 32 characters."""
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=255),
        type_=sa.String(length=32),
        existing_nullable=False,
    )
