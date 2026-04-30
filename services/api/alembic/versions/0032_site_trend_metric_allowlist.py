"""Optional per-site trend metric allowlist (comma-separated keys).

Revision ID: 0032
Revises: 0031
Create Date: 2026-04-30

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: Union[str, None] = "0031_endpoint_identity_publish"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sites",
        sa.Column("trend_metric_allowlist", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sites", "trend_metric_allowlist")
