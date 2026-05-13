"""Device CSV import audit table.

Revision ID: 0034_device_import_audit
Revises: 0033_device_versioning_metadata
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0034_device_import_audit"
down_revision: Union[str, None] = "0033_device_versioning_metadata"
branch_labels = None
depends_on = None


def _table_exists(connection: sa.Connection, table: str) -> bool:
    row = connection.execute(
        text(
            """
            SELECT EXISTS (
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = :t
            )
            """
        ),
        {"t": table},
    ).scalar()
    return bool(row)


def upgrade() -> None:
    conn = op.get_bind()
    if _table_exists(conn, "device_import_audits"):
        return
    op.create_table(
        "device_import_audits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source_label", sa.String(length=255), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("detail_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_device_import_audits_customer_id", "device_import_audits", ["customer_id"], unique=False)
    op.create_index("ix_device_import_audits_created_at", "device_import_audits", ["created_at"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    if not _table_exists(conn, "device_import_audits"):
        return
    op.drop_index("ix_device_import_audits_created_at", table_name="device_import_audits")
    op.drop_index("ix_device_import_audits_customer_id", table_name="device_import_audits")
    op.drop_table("device_import_audits")
