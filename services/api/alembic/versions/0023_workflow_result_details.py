"""workflow_result_object_details + latest pointers on workflow_result_objects (Phase C).

Revision ID must stay <= 32 chars (alembic_version.version_num is VARCHAR(32)).

Revision ID: 0023_workflow_result_details
Revises: 0022_data_object_details
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_workflow_result_details"
down_revision: Union[str, None] = "0022_data_object_details"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workflow_result_object_details",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_result_object_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_execution_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.Column("health_status", sa.String(length=16), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["workflow_execution_id"], ["workflow_executions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workflow_result_object_id"], ["workflow_result_objects.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_wf_result_details_result_observed",
        "workflow_result_object_details",
        ["workflow_result_object_id", "observed_at"],
    )
    op.create_index(
        "ix_wf_result_details_customer_id",
        "workflow_result_object_details",
        ["customer_id"],
    )
    op.create_index(
        "ix_wf_result_details_site_id",
        "workflow_result_object_details",
        ["site_id"],
    )

    op.add_column(
        "workflow_result_objects",
        sa.Column("latest_detail_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "workflow_result_objects",
        sa.Column("latest_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_workflow_result_objects_latest_detail_id",
        "workflow_result_objects",
        "workflow_result_object_details",
        ["latest_detail_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_workflow_result_objects_latest_detail_id",
        "workflow_result_objects",
        type_="foreignkey",
    )
    op.drop_column("workflow_result_objects", "latest_seen_at")
    op.drop_column("workflow_result_objects", "latest_detail_id")
    op.drop_index("ix_wf_result_details_site_id", table_name="workflow_result_object_details")
    op.drop_index("ix_wf_result_details_customer_id", table_name="workflow_result_object_details")
    op.drop_index("ix_wf_result_details_result_observed", table_name="workflow_result_object_details")
    op.drop_table("workflow_result_object_details")
