"""Grant simulation.run to device_operator (replay / OTA wizard).

Revision ID: 0047_device_operator_simulation_run
Revises: 0046_rbac_lineage_audit_deprecate
"""

from __future__ import annotations

from typing import Union

from alembic import op
from sqlalchemy import text

revision: str = "0047_device_operator_simulation_run"
down_revision: Union[str, None] = "0046_rbac_lineage_audit_deprecate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            JOIN permissions p ON p.permission_key = 'simulation.run'
            WHERE r.role_key = 'device_operator'
            ON CONFLICT (role_id, permission_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text(
            """
            DELETE FROM role_permissions rp
            USING permissions p, roles r
            WHERE rp.permission_id = p.id
              AND rp.role_id = r.id
              AND r.role_key = 'device_operator'
              AND p.permission_key = 'simulation.run'
            """
        )
    )
