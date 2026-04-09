"""Align legacy bootstrap email with EmailStr (Pydantic).

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-05

"""

from typing import Sequence, Union

from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE users
        SET email = 'admin@example.com'
        WHERE email = 'admin@localhost' AND is_superuser IS TRUE
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE users
        SET email = 'admin@localhost'
        WHERE email = 'admin@example.com'
          AND is_superuser IS TRUE
          AND full_name = 'Bootstrap admin'
        """
    )
