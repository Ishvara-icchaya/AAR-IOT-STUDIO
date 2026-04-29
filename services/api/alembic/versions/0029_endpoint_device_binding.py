"""Link v2 endpoints to legacy device_endpoints for MQTT bridge binding.

Revision ID: 0029_endpoint_device_binding
Revises: 0028_v2_core_schema
Create Date: 2026-04-28 13:35:00.000000
"""

from __future__ import annotations

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql


revision: str = "0029_endpoint_device_binding"
down_revision: Union[str, None] = "0028_v2_core_schema"
branch_labels = None
depends_on = None


def _column_exists(connection: sa.Connection, table: str, column: str) -> bool:
    row = connection.execute(
        text(
            """
            SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = :t AND column_name = :c
            )
            """
        ),
        {"t": table, "c": column},
    ).scalar()
    return bool(row)


def _constraint_exists(connection: sa.Connection, name: str) -> bool:
    row = connection.execute(
        text(
            """
            SELECT EXISTS (
              SELECT 1 FROM information_schema.table_constraints
              WHERE constraint_schema = 'public' AND constraint_name = :n
            )
            """
        ),
        {"n": name},
    ).scalar()
    return bool(row)


def _index_exists(connection: sa.Connection, name: str) -> bool:
    row = connection.execute(
        text("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = :n)"),
        {"n": name},
    ).scalar()
    return bool(row)


def upgrade() -> None:
    conn = op.get_bind()
    if not _column_exists(conn, "endpoints", "device_endpoint_id"):
        op.add_column(
            "endpoints",
            sa.Column("device_endpoint_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    if not _constraint_exists(conn, "fk_endpoints_device_endpoint_id"):
        op.create_foreign_key(
            "fk_endpoints_device_endpoint_id",
            "endpoints",
            "device_endpoints",
            ["device_endpoint_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _index_exists(conn, "uq_endpoints_device_endpoint_id_not_null"):
        op.create_index(
            "uq_endpoints_device_endpoint_id_not_null",
            "endpoints",
            ["device_endpoint_id"],
            unique=True,
            postgresql_where=sa.text("device_endpoint_id IS NOT NULL"),
        )


def downgrade() -> None:
    op.execute(text("DROP INDEX IF EXISTS uq_endpoints_device_endpoint_id_not_null"))
    op.execute(text("ALTER TABLE endpoints DROP CONSTRAINT IF EXISTS fk_endpoints_device_endpoint_id"))
    op.execute(text("ALTER TABLE endpoints DROP COLUMN IF EXISTS device_endpoint_id"))
