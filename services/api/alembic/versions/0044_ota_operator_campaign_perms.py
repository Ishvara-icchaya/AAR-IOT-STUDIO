"""Grant device_operator ota.create and ota.approve for end-to-end campaign workflows.

Revision ID: 0044_ota_operator_campaign_perms
Revises: 0043_rbac_device_versions_simulation
"""

from __future__ import annotations

from typing import Union

from alembic import op
from sqlalchemy import text

revision: str = "0044_ota_operator_campaign_perms"
down_revision: Union[str, None] = "0043_rbac_device_versions_simulation"
branch_labels = None
depends_on = None

KEYS = ("ota.create", "ota.approve")


def upgrade() -> None:
    conn = op.get_bind()
    for pk in KEYS:
        conn.execute(
            text(
                "INSERT INTO permissions (id, permission_key, description) "
                "SELECT gen_random_uuid(), :pk, :d "
                "WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_key = :pk)"
            ),
            {
                "pk": pk,
                "d": "OTA campaign create" if pk == "ota.create" else "Approve OTA campaigns",
            },
        )
    for pk in KEYS:
        conn.execute(
            text(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM roles r
                JOIN permissions p ON p.permission_key = :pk
                WHERE r.role_key = 'device_operator'
                ON CONFLICT (role_id, permission_id) DO NOTHING
                """
            ),
            {"pk": pk},
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
              AND p.permission_key = ANY(CAST(:keys AS text[]))
            """
        ),
        {"keys": list(KEYS)},
    )
