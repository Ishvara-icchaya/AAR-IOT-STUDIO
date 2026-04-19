"""data_object_details observed layer + latest pointers on data_objects.

Revision ID: 0022_data_object_details
Revises: 0021_ref_integrity_lifecycle
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022_data_object_details"
down_revision: Union[str, None] = "0021_ref_integrity_lifecycle"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_object_details",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("data_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("raw_data_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "payload_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "kpi_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("health_status", sa.String(length=16), nullable=True),
        sa.Column("health_code", sa.String(length=64), nullable=True),
        sa.Column("health_message", sa.Text(), nullable=True),
        sa.Column(
            "grouping_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("trace_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["data_object_id"], ["data_objects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["raw_data_object_id"], ["raw_data_objects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_object_details_data_object_observed", "data_object_details", ["data_object_id", "observed_at"])
    op.create_index("ix_data_object_details_customer_id", "data_object_details", ["customer_id"])
    op.create_index("ix_data_object_details_site_id", "data_object_details", ["site_id"])
    op.create_index("ix_data_object_details_device_id", "data_object_details", ["device_id"])

    op.add_column(
        "data_objects",
        sa.Column("latest_detail_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "data_objects",
        sa.Column("latest_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_data_objects_latest_detail_id",
        "data_objects",
        "data_object_details",
        ["latest_detail_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_data_objects_latest_detail_id", "data_objects", type_="foreignkey")
    op.drop_column("data_objects", "latest_seen_at")
    op.drop_column("data_objects", "latest_detail_id")
    op.drop_index("ix_data_object_details_device_id", table_name="data_object_details")
    op.drop_index("ix_data_object_details_site_id", table_name="data_object_details")
    op.drop_index("ix_data_object_details_customer_id", table_name="data_object_details")
    op.drop_index("ix_data_object_details_data_object_observed", table_name="data_object_details")
    op.drop_table("data_object_details")
