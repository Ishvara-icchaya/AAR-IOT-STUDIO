"""Device firmware / OTA readiness / version metadata for Manage Devices (v8 checkpoint).

Revision ID: 0033_device_versioning_metadata
Revises: 0032 (migration file ``0032_site_trend_metric_allowlist.py`` — revision id is ``0032``).
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "0033_device_versioning_metadata"
down_revision: Union[str, None] = "0032"
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
    if not _column_exists(conn, "devices", "firmware_version"):
        op.add_column("devices", sa.Column("firmware_version", sa.String(length=128), nullable=True))
    if not _column_exists(conn, "devices", "firmware_channel"):
        op.add_column(
            "devices",
            sa.Column("firmware_channel", sa.String(length=32), nullable=False, server_default="stable"),
        )
    if not _column_exists(conn, "devices", "ota_supported"):
        op.add_column(
            "devices",
            sa.Column("ota_supported", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if not _column_exists(conn, "devices", "rollback_supported"):
        op.add_column(
            "devices",
            sa.Column("rollback_supported", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if not _column_exists(conn, "devices", "device_version"):
        op.add_column(
            "devices",
            sa.Column("device_version", sa.String(length=64), nullable=False, server_default="1"),
        )
    if not _column_exists(conn, "devices", "version_status"):
        op.add_column(
            "devices",
            sa.Column("version_status", sa.String(length=32), nullable=False, server_default="active"),
        )


def downgrade() -> None:
    conn = op.get_bind()
    for col in (
        "version_status",
        "device_version",
        "rollback_supported",
        "ota_supported",
        "firmware_channel",
        "firmware_version",
    ):
        if _column_exists(conn, "devices", col):
            op.drop_column("devices", col)
