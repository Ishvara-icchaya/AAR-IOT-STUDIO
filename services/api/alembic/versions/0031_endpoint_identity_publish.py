"""Endpoint identity draft + publish timestamp for v2 activation gate.

Revision ID: 0031_endpoint_identity_publish
Revises: 0030_endpoint_lifecycle_sample
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0031_endpoint_identity_publish"
down_revision: Union[str, None] = "0030_endpoint_lifecycle_sample"
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


def upgrade() -> None:
    conn = op.get_bind()
    if not _column_exists(conn, "endpoints", "identity_published_at"):
        op.add_column(
            "endpoints",
            sa.Column("identity_published_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _column_exists(conn, "endpoints", "identity_draft"):
        op.add_column(
            "endpoints",
            sa.Column("identity_draft", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        )

    op.execute(
        """
        UPDATE endpoints
        SET identity_published_at = COALESCE(updated_at, NOW())
        WHERE primary_device_key_fields IS NOT NULL
          AND jsonb_typeof(primary_device_key_fields) = 'array'
          AND jsonb_array_length(primary_device_key_fields) >= 1
          AND identity_published_at IS NULL
        """
    )


def downgrade() -> None:
    conn = op.get_bind()
    if _column_exists(conn, "endpoints", "identity_draft"):
        op.drop_column("endpoints", "identity_draft")
    if _column_exists(conn, "endpoints", "identity_published_at"):
        op.drop_column("endpoints", "identity_published_at")
