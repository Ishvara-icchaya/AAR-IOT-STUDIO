"""Label platform operators: role platform_admin + ensure is_superuser.

Revision ID: 0038_platform_admin_role_label
Revises: 0037_tenant_user_roles_rbac
"""

from __future__ import annotations

from typing import Union

from alembic import op
from sqlalchemy import text

revision: str = "0038_platform_admin_role_label"
down_revision: Union[str, None] = "0037_tenant_user_roles_rbac"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        text(
            """
            UPDATE users
            SET is_superuser = true,
                role = 'platform_admin'
            WHERE is_superuser IS TRUE
               OR full_name = 'Bootstrap admin'
            """
        )
    )


def downgrade() -> None:
    op.execute(
        text(
            """
            UPDATE users
            SET role = 'admin'
            WHERE role = 'platform_admin' AND is_superuser IS TRUE
            """
        )
    )
