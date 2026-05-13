"""RBAC: lineage.read, audit.read, device_versions.deprecate, ota.rollback (operator).

Revision ID: 0046_rbac_lineage_audit_deprecate
Revises: 0045_simulation_jobs_control_plane_audit
"""

from __future__ import annotations

from typing import Union

from alembic import op
from sqlalchemy import text

revision: str = "0046_rbac_lineage_audit_deprecate"
down_revision: Union[str, None] = "0045_simulation_jobs_control_plane_audit"
branch_labels = None
depends_on = None

NEW_PERMS: tuple[tuple[str, str], ...] = (
    ("lineage.read", "View device version lineage timeline"),
    ("audit.read", "View control-plane audit events"),
    ("device_versions.deprecate", "Mark a device version as deprecated"),
)


def upgrade() -> None:
    conn = op.get_bind()
    for pk, desc in NEW_PERMS:
        conn.execute(
            text(
                "INSERT INTO permissions (id, permission_key, description) "
                "SELECT gen_random_uuid(), :pk, :d "
                "WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_key = :pk)"
            ),
            {"pk": pk, "d": desc},
        )

    def grant(role_key: str, perm_key: str) -> None:
        conn.execute(
            text(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM roles r
                JOIN permissions p ON p.permission_key = :pk
                WHERE r.role_key = :rk
                ON CONFLICT (role_id, permission_id) DO NOTHING
                """
            ),
            {"rk": role_key, "pk": perm_key},
        )

    for rk in ("platform_admin", "customer_admin", "site_admin"):
        for pk, _ in NEW_PERMS:
            grant(rk, pk)

    for pk in ("lineage.read", "device_versions.deprecate"):
        grant("developer", pk)

    for pk in ("lineage.read", "device_versions.deprecate"):
        grant("device_operator", pk)

    grant("device_viewer", "lineage.read")

    conn.execute(
        text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT rp.role_id, p_new.id
            FROM role_permissions rp
            JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.permission_key = 'device_versions.promote'
            JOIN permissions p_new ON p_new.permission_key = 'device_versions.deprecate'
            ON CONFLICT (role_id, permission_id) DO NOTHING
            """
        )
    )

    grant("device_operator", "ota.rollback")


def downgrade() -> None:
    conn = op.get_bind()
    keys = ["lineage.read", "audit.read", "device_versions.deprecate"]
    conn.execute(
        text(
            """
            DELETE FROM role_permissions rp
            USING permissions p
            WHERE rp.permission_id = p.id
              AND p.permission_key = ANY(CAST(:keys AS text[]))
            """
        ),
        {"keys": keys},
    )
    conn.execute(
        text(
            """
            DELETE FROM role_permissions rp
            USING permissions p, roles r
            WHERE rp.permission_id = p.id AND rp.role_id = r.id
              AND r.role_key = 'device_operator'
              AND p.permission_key = 'ota.rollback'
            """
        ),
    )
    conn.execute(
        text("DELETE FROM permissions WHERE permission_key = ANY(CAST(:keys AS text[]))"),
        {"keys": keys},
    )
