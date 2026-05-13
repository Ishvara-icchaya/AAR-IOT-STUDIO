"""Seed permissions for device_versions.*, simulation.run, and device_operator ota.launch.

Revision ID: 0043_rbac_device_versions_simulation
Revises: 0042_ota_campaigns_routing_candidate
"""

from __future__ import annotations

from typing import Union

from alembic import op
from sqlalchemy import text

revision: str = "0043_rbac_device_versions_simulation"
down_revision: Union[str, None] = "0042_ota_campaigns_routing_candidate"
branch_labels = None
depends_on = None

# Align with app.services.permission_catalog.PERMISSION_METADATA (subset introduced after 0036).
NEW_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("device_versions.read", "View immutable device version rows"),
    ("device_versions.promote", "Promote a device version to shared active"),
    ("device_versions.isolate", "Isolate a device version to candidate lane"),
    ("device_versions.rollback", "Rollback to the previous device version"),
    ("simulation.run", "Run compatibility / replay simulation jobs"),
)


def upgrade() -> None:
    conn = op.get_bind()
    for pk, desc in NEW_PERMISSIONS:
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

    new_keys = tuple(p[0] for p in NEW_PERMISSIONS)
    for rk in ("platform_admin", "site_admin", "customer_admin"):
        for pk in new_keys:
            grant(rk, pk)

    for pk in ("device_versions.read", "simulation.run"):
        grant("developer", pk)

    grant("device_operator", "device_versions.read")
    # Catalog grants ota.launch to device_operator; 0036 seed did not include it.
    grant("device_operator", "ota.launch")


def downgrade() -> None:
    conn = op.get_bind()
    keys = list(p[0] for p in NEW_PERMISSIONS)
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
            WHERE rp.permission_id = p.id
              AND rp.role_id = r.id
              AND r.role_key = 'device_operator'
              AND p.permission_key = 'ota.launch'
            """
        ),
    )
    conn.execute(
        text("DELETE FROM permissions WHERE permission_key = ANY(CAST(:keys AS text[]))"),
        {"keys": keys},
    )
