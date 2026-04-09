"""Raw object lifecycle, verification fields, protocol source.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "raw_data_objects",
        sa.Column("ingest_status", sa.String(32), nullable=False, server_default="archived"),
    )
    op.add_column(
        "raw_data_objects",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "raw_data_objects",
        sa.Column(
            "verify_status",
            sa.String(32),
            nullable=False,
            server_default="never",
        ),
    )
    op.add_column(
        "raw_data_objects",
        sa.Column("verify_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "raw_data_objects",
        sa.Column("protocol_source", sa.String(32), nullable=True),
    )
    op.create_index(
        "ix_raw_data_objects_ingest_status",
        "raw_data_objects",
        ["ingest_status"],
    )
    op.create_index(
        "ix_raw_data_objects_ingested_at",
        "raw_data_objects",
        ["ingested_at"],
    )
    op.execute(
        """
        UPDATE raw_data_objects
        SET protocol_source = COALESCE(protocol_source, 'upload')
        """
    )


def downgrade() -> None:
    op.drop_index("ix_raw_data_objects_ingested_at", table_name="raw_data_objects")
    op.drop_index("ix_raw_data_objects_ingest_status", table_name="raw_data_objects")
    op.drop_column("raw_data_objects", "protocol_source")
    op.drop_column("raw_data_objects", "verify_message")
    op.drop_column("raw_data_objects", "verify_status")
    op.drop_column("raw_data_objects", "verified_at")
    op.drop_column("raw_data_objects", "ingest_status")
