"""data_objects: site_id, kpi_json, health fields, scrubber_version, indexes.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "data_objects",
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        """
        UPDATE data_objects d
        SET site_id = dev.site_id
        FROM devices dev
        WHERE dev.id = d.device_id
        """
    )
    op.alter_column("data_objects", "site_id", nullable=False)

    op.create_foreign_key(
        "fk_data_objects_site_id_sites",
        "data_objects",
        "sites",
        ["site_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_data_objects_site_id", "data_objects", ["site_id"])

    op.add_column(
        "data_objects",
        sa.Column(
            "kpi_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "data_objects",
        sa.Column("health_status", sa.String(16), nullable=True),
    )
    op.add_column(
        "data_objects",
        sa.Column("health_code", sa.String(64), nullable=True),
    )
    op.add_column(
        "data_objects",
        sa.Column("health_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "data_objects",
        sa.Column("scrubber_version", sa.String(64), nullable=True),
    )

    op.create_index("ix_data_objects_created_at", "data_objects", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_data_objects_created_at", table_name="data_objects")
    op.drop_column("data_objects", "scrubber_version")
    op.drop_column("data_objects", "health_message")
    op.drop_column("data_objects", "health_code")
    op.drop_column("data_objects", "health_status")
    op.drop_column("data_objects", "kpi_json")
    op.drop_index("ix_data_objects_site_id", table_name="data_objects")
    op.drop_constraint("fk_data_objects_site_id_sites", "data_objects", type_="foreignkey")
    op.drop_column("data_objects", "site_id")
