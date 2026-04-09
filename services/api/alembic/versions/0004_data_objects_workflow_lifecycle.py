"""data_objects table + workflow lifecycle_status column.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_objects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("raw_data_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(255), nullable=False, server_default="Data object"),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "lifecycle_status",
            sa.String(32),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["raw_data_object_id"], ["raw_data_objects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_objects_customer_id", "data_objects", ["customer_id"])
    op.create_index("ix_data_objects_device_id", "data_objects", ["device_id"])
    op.create_index("ix_data_objects_raw_data_object_id", "data_objects", ["raw_data_object_id"])
    op.create_index("ix_data_objects_lifecycle_status", "data_objects", ["lifecycle_status"])

    op.add_column(
        "workflows",
        sa.Column("lifecycle_status", sa.String(32), nullable=True),
    )
    op.execute("UPDATE workflows SET lifecycle_status = status")
    op.alter_column(
        "workflows",
        "lifecycle_status",
        nullable=False,
        server_default="draft",
    )
    op.drop_column("workflows", "status")


def downgrade() -> None:
    op.add_column(
        "workflows",
        sa.Column("status", sa.String(32), nullable=True, server_default="draft"),
    )
    op.execute("UPDATE workflows SET status = lifecycle_status")
    op.alter_column("workflows", "status", nullable=False)
    op.drop_column("workflows", "lifecycle_status")

    op.drop_index("ix_data_objects_lifecycle_status", table_name="data_objects")
    op.drop_index("ix_data_objects_raw_data_object_id", table_name="data_objects")
    op.drop_index("ix_data_objects_device_id", table_name="data_objects")
    op.drop_index("ix_data_objects_customer_id", table_name="data_objects")
    op.drop_table("data_objects")
