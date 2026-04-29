"""Endpoint lifecycle, sample payload, nullable primary_device_key_fields.

Revision ID: 0030_endpoint_lifecycle_sample
Revises: 0029_endpoint_device_binding
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0030_endpoint_lifecycle_sample"
down_revision: Union[str, None] = "0029_endpoint_device_binding"
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


def _column_is_nullable(connection: sa.Connection, table: str, column: str) -> bool:
    row = connection.execute(
        text(
            """
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = :t AND column_name = :c
            """
        ),
        {"t": table, "c": column},
    ).scalar()
    return row == "YES"


def upgrade() -> None:
    conn = op.get_bind()
    if not _column_exists(conn, "endpoints", "lifecycle_status"):
        op.add_column(
            "endpoints",
            sa.Column(
                "lifecycle_status",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'draft'"),
            ),
        )
    if not _column_exists(conn, "endpoints", "sample_payload"):
        op.add_column(
            "endpoints",
            sa.Column("sample_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        )
    if not _column_exists(conn, "endpoints", "sample_ingested_at"):
        op.add_column(
            "endpoints",
            sa.Column("sample_ingested_at", sa.DateTime(timezone=True), nullable=True),
        )

    op.execute(
        """
        UPDATE endpoints
        SET lifecycle_status = 'active'
        WHERE primary_device_key_fields IS NOT NULL
          AND jsonb_typeof(primary_device_key_fields) = 'array'
          AND jsonb_array_length(primary_device_key_fields) >= 1
        """
    )
    op.execute(
        """
        UPDATE endpoints
        SET lifecycle_status = 'needs_identity_mapping'
        WHERE lifecycle_status = 'draft'
        """
    )

    if _column_exists(conn, "endpoints", "primary_device_key_fields") and not _column_is_nullable(
        conn, "endpoints", "primary_device_key_fields"
    ):
        op.alter_column(
            "endpoints",
            "primary_device_key_fields",
            existing_type=postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=None,
        )
    op.execute(
        """
        UPDATE endpoints
        SET primary_device_key_fields = NULL
        WHERE primary_device_key_fields IS NOT NULL
          AND jsonb_typeof(primary_device_key_fields) = 'array'
          AND jsonb_array_length(primary_device_key_fields) < 1
        """
    )


def downgrade() -> None:
    conn = op.get_bind()
    op.execute(
        """
        UPDATE endpoints
        SET primary_device_key_fields = '[]'::jsonb
        WHERE primary_device_key_fields IS NULL
        """
    )
    if _column_exists(conn, "endpoints", "primary_device_key_fields") and _column_is_nullable(
        conn, "endpoints", "primary_device_key_fields"
    ):
        op.alter_column(
            "endpoints",
            "primary_device_key_fields",
            existing_type=postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        )
    if _column_exists(conn, "endpoints", "sample_ingested_at"):
        op.drop_column("endpoints", "sample_ingested_at")
    if _column_exists(conn, "endpoints", "sample_payload"):
        op.drop_column("endpoints", "sample_payload")
    if _column_exists(conn, "endpoints", "lifecycle_status"):
        op.drop_column("endpoints", "lifecycle_status")
