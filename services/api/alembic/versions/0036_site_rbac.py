"""Site user role bindings (RBAC) with roles, permissions, and seed data.

Revision ID: 0036_site_rbac
Revises: 0035_informational_alert
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0036_site_rbac"
down_revision: Union[str, None] = "0035_informational_alert"
branch_labels = None
depends_on = None


def _pk(ns: str, key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"aar-iot-studio.{ns}.{key}"))


ROLE_ROWS = [
    ("platform_admin", "Platform admin", "Full platform access across all tenants."),
    ("customer_admin", "Customer admin", "All sites and users within the customer tenant."),
    ("site_admin", "Site admin", "Manage users, devices, and dashboards for a site."),
    ("developer", "Developer", "Endpoints, scrubbers, workflows, and APIs."),
    ("device_operator", "Device operator", "Devices, status, footprint, and OTA visibility."),
    ("device_viewer", "Device viewer", "Read-only device list and status."),
    ("dashboard_viewer", "Dashboard viewer", "Dashboards only (read)."),
]

PERM_ROWS = [
    ("devices.read", "View devices and device status"),
    ("devices.write", "Create and update devices"),
    ("devices.import", "Bulk import devices from CSV"),
    ("devices.footprint.read", "View operational footprint and readiness"),
    ("dashboards.read", "View dashboards"),
    ("dashboards.write", "Create and edit dashboards"),
    ("dashboards.publish", "Publish dashboards"),
    ("endpoints.read", "View device endpoints"),
    ("endpoints.write", "Create and configure endpoints"),
    ("scrubbers.read", "View scrubber pipelines and previews"),
    ("scrubbers.write", "Create and edit scrubber pipelines"),
    ("workflows.read", "View workflows"),
    ("workflows.write", "Create and edit workflows"),
    ("ota.read", "View OTA status"),
    ("ota.create", "Create OTA jobs"),
    ("ota.approve", "Approve OTA jobs"),
    ("ota.launch", "Launch OTA rollouts"),
    ("ota.rollback", "Rollback OTA"),
    ("users.read", "List site users and assignments"),
    ("users.invite", "Add existing tenant users to a site"),
    ("users.assign_roles", "Change site roles for users"),
]

ROLE_TO_PERMS: dict[str, frozenset[str]] = {
    "platform_admin": frozenset(p[0] for p in PERM_ROWS),
    "customer_admin": frozenset(p[0] for p in PERM_ROWS),
    "site_admin": frozenset(p[0] for p in PERM_ROWS),
    "developer": frozenset(
        {
            "devices.read",
            "endpoints.read",
            "endpoints.write",
            "scrubbers.read",
            "scrubbers.write",
            "workflows.read",
            "workflows.write",
        }
    ),
    "device_operator": frozenset(
        {
            "devices.read",
            "devices.write",
            "devices.footprint.read",
            "ota.read",
        }
    ),
    "device_viewer": frozenset({"devices.read"}),
    "dashboard_viewer": frozenset({"dashboards.read"}),
}


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("role_key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_index("ix_roles_role_key", "roles", ["role_key"], unique=True)

    op.create_table(
        "permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("permission_key", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_index("ix_permissions_permission_key", "permissions", ["permission_key"], unique=True)

    op.create_table(
        "role_permissions",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("permission_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "permission_id"),
    )

    op.create_table(
        "site_user_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("site_id", "user_id", name="uq_site_user_roles_site_user"),
    )
    op.create_index("ix_site_user_roles_site_id", "site_user_roles", ["site_id"])
    op.create_index("ix_site_user_roles_user_id", "site_user_roles", ["user_id"])

    role_ids: dict[str, str] = {}
    for key, name, desc in ROLE_ROWS:
        rid = _pk("role", key)
        role_ids[key] = rid
        op.execute(
            sa.text(
                "INSERT INTO roles (id, role_key, name, description) "
                "VALUES (:id, :rk, :n, :d)"
            ).bindparams(id=rid, rk=key, n=name, d=desc)
        )

    perm_ids: dict[str, str] = {}
    for pkey, pdesc in PERM_ROWS:
        pid = _pk("perm", pkey)
        perm_ids[pkey] = pid
        op.execute(
            sa.text(
                "INSERT INTO permissions (id, permission_key, description) "
                "VALUES (:id, :pk, :d)"
            ).bindparams(id=pid, pk=pkey, d=pdesc)
        )

    for rk, pkeys in ROLE_TO_PERMS.items():
        rid = role_ids[rk]
        for pk in pkeys:
            pid = perm_ids[pk]
            op.execute(
                sa.text("INSERT INTO role_permissions (role_id, permission_id) VALUES (:rid, :pid)").bindparams(
                    rid=rid, pid=pid
                )
            )

    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    r_ca = role_ids["customer_admin"]
    r_do = role_ids["device_operator"]

    users = conn.execute(text("SELECT id, customer_id, role, is_superuser FROM users")).mappings().all()
    for u in users:
        if u["is_superuser"]:
            continue
        uid = str(u["id"])
        cid = str(u["customer_id"])
        role_key = (u["role"] or "operator").lower()
        rid_bind = r_ca if role_key == "admin" else r_do

        site_rows = conn.execute(
            text("SELECT id FROM sites WHERE customer_id = CAST(:cid AS uuid)"),
            {"cid": cid},
        ).fetchall()
        site_ids = [str(r[0]) for r in site_rows]
        if role_key != "admin":
            us_rows = conn.execute(
                text("SELECT site_id FROM user_sites WHERE user_id = CAST(:uid AS uuid)"),
                {"uid": uid},
            ).fetchall()
            explicit = [str(r[0]) for r in us_rows]
            if explicit:
                site_ids = explicit

        for sid in site_ids:
            sur_id = str(uuid.uuid4())
            conn.execute(
                text(
                    "INSERT INTO site_user_roles "
                    "(id, site_id, user_id, role_id, created_at, created_by, is_active) "
                    "VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), CAST(:uid AS uuid), "
                    "CAST(:rid AS uuid), :ts, NULL, true) "
                    "ON CONFLICT (site_id, user_id) DO NOTHING"
                ),
                {"id": sur_id, "sid": sid, "uid": uid, "rid": rid_bind, "ts": now},
            )


def downgrade() -> None:
    op.drop_index("ix_site_user_roles_user_id", table_name="site_user_roles")
    op.drop_index("ix_site_user_roles_site_id", table_name="site_user_roles")
    op.drop_table("site_user_roles")
    op.drop_table("role_permissions")
    op.drop_index("ix_permissions_permission_key", table_name="permissions")
    op.drop_table("permissions")
    op.drop_index("ix_roles_role_key", table_name="roles")
    op.drop_table("roles")
