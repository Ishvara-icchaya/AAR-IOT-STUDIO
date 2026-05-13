"""Tenant-level RBAC bindings, user invite fields, partial unique indexes on bindings.

Revision ID: 0037_tenant_user_roles_rbac
Revises: 0036_site_rbac
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0037_tenant_user_roles_rbac"
down_revision: Union[str, None] = "0036_site_rbac"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("account_status", sa.String(32), nullable=False, server_default="active"),
    )
    op.add_column("users", sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_users_invited_by",
        "users",
        "users",
        ["invited_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        text(
            "UPDATE users SET account_status = CASE WHEN is_active THEN 'active' ELSE 'disabled' END"
        )
    )
    op.alter_column("users", "account_status", server_default=None)

    op.create_table(
        "tenant_user_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_tenant_user_roles_customer_id", "tenant_user_roles", ["customer_id"])
    op.create_index("ix_tenant_user_roles_user_id", "tenant_user_roles", ["user_id"])

    conn = op.get_bind()

    conn.execute(
        text(
            """
            INSERT INTO tenant_user_roles (id, customer_id, user_id, role_id, created_at, created_by, is_active)
            SELECT gen_random_uuid(), d.customer_id, d.user_id, d.role_id, d.created_at, d.created_by, true
            FROM (
                SELECT DISTINCT ON (sur.user_id, s.customer_id)
                    s.customer_id,
                    sur.user_id,
                    sur.role_id,
                    sur.created_at,
                    sur.created_by
                FROM site_user_roles sur
                INNER JOIN sites s ON s.id = sur.site_id
                INNER JOIN roles r ON r.id = sur.role_id AND r.role_key = 'customer_admin'
                WHERE sur.is_active = true
                ORDER BY sur.user_id, s.customer_id, sur.created_at ASC NULLS LAST
            ) AS d
            """
        )
    )

    conn.execute(
        text(
            """
            INSERT INTO tenant_user_roles (id, customer_id, user_id, role_id, created_at, created_by, is_active)
            SELECT gen_random_uuid(), u.customer_id, u.id, r.id, now(), NULL, true
            FROM users u
            INNER JOIN roles r ON r.role_key = 'customer_admin'
            WHERE lower(u.role) = 'admin'
              AND u.is_superuser IS false
              AND NOT EXISTS (
                  SELECT 1 FROM tenant_user_roles tur
                  WHERE tur.user_id = u.id
                    AND tur.customer_id = u.customer_id
                    AND tur.is_active = true
              )
            """
        )
    )

    conn.execute(
        text(
            """
            UPDATE site_user_roles sur
            SET is_active = false
            FROM roles r
            WHERE sur.role_id = r.id AND r.role_key = 'customer_admin'
            """
        )
    )

    op.drop_constraint("uq_site_user_roles_site_user", "site_user_roles", type_="unique")
    op.execute(
        text(
            "CREATE UNIQUE INDEX ux_site_user_roles_active "
            "ON site_user_roles (site_id, user_id) WHERE is_active = true"
        )
    )
    op.execute(
        text(
            "CREATE UNIQUE INDEX ux_tenant_user_roles_active "
            "ON tenant_user_roles (customer_id, user_id) WHERE is_active = true"
        )
    )


def downgrade() -> None:
    op.execute(text("DROP INDEX IF EXISTS ux_tenant_user_roles_active"))
    op.execute(text("DROP INDEX IF EXISTS ux_site_user_roles_active"))
    op.create_unique_constraint("uq_site_user_roles_site_user", "site_user_roles", ["site_id", "user_id"])
    op.drop_index("ix_tenant_user_roles_user_id", table_name="tenant_user_roles")
    op.drop_index("ix_tenant_user_roles_customer_id", table_name="tenant_user_roles")
    op.drop_table("tenant_user_roles")
    op.drop_constraint("fk_users_invited_by", "users", type_="foreignkey")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "invited_by")
    op.drop_column("users", "invited_at")
    op.drop_column("users", "account_status")
