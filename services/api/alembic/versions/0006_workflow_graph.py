"""Workflow graph tables, executions, result definitions and runtime results.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("workflows", sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("workflows", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "workflows",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "workflows",
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "workflows",
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_workflows_site_id_sites",
        "workflows",
        "sites",
        ["site_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_workflows_created_by_user_id_users",
        "workflows",
        "users",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_workflows_site_id", "workflows", ["site_id"])
    op.create_index("ix_workflows_customer_site", "workflows", ["customer_id", "site_id"])

    op.execute(
        """
        UPDATE workflows w
        SET site_id = (
            SELECT s.id FROM sites s
            WHERE s.customer_id = w.customer_id
            ORDER BY s.created_at ASC NULLS LAST
            LIMIT 1
        )
        WHERE site_id IS NULL
        """
    )

    op.create_table(
        "workflow_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("node_type", sa.String(64), nullable=False),
        sa.Column("node_name", sa.String(255), nullable=False),
        sa.Column(
            "config_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("position_x", sa.Double(), nullable=False, server_default="0"),
        sa.Column("position_y", sa.Double(), nullable=False, server_default="0"),
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
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_nodes_workflow_id", "workflow_nodes", ["workflow_id"])
    op.create_index("ix_workflow_nodes_type", "workflow_nodes", ["node_type"])

    op.create_table(
        "workflow_edges",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_node_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_node_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_node_id"], ["workflow_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_node_id"], ["workflow_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_edges_workflow_id", "workflow_edges", ["workflow_id"])
    op.create_index("ix_workflow_edges_source", "workflow_edges", ["source_node_id"])
    op.create_index("ix_workflow_edges_target", "workflow_edges", ["target_node_id"])

    op.create_table(
        "result_object_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("terminate_node_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("result_object_name", sa.String(255), nullable=False),
        sa.Column(
            "schema_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["terminate_node_id"], ["workflow_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_result_object_defs_workflow", "result_object_definitions", ["workflow_id"])
    op.create_unique_constraint(
        "uq_result_object_defs_terminate_node",
        "result_object_definitions",
        ["terminate_node_id"],
    )

    op.create_table(
        "workflow_executions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trigger_type", sa.String(64), nullable=False),
        sa.Column("input_data_object_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "node_outputs_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["input_data_object_id"], ["data_objects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workflow_executions_workflow", "workflow_executions", ["workflow_id"])
    op.create_index("ix_workflow_executions_started", "workflow_executions", ["started_at"])

    op.create_table(
        "workflow_node_outputs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_execution_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("node_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "payload_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["workflow_execution_id"], ["workflow_executions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["node_id"], ["workflow_nodes.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wf_node_outputs_execution", "workflow_node_outputs", ["workflow_execution_id"])

    op.create_table(
        "workflow_result_objects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_execution_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("terminate_node_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("result_object_name", sa.String(255), nullable=False),
        sa.Column("customer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "payload_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("health_status", sa.String(16), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["workflow_execution_id"], ["workflow_executions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["terminate_node_id"], ["workflow_nodes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_wf_result_objects_workflow", "workflow_result_objects", ["workflow_id"])
    op.create_index("ix_wf_result_objects_site_name", "workflow_result_objects", ["site_id", "result_object_name"])


def downgrade() -> None:
    op.drop_index("ix_wf_result_objects_site_name", table_name="workflow_result_objects")
    op.drop_index("ix_wf_result_objects_workflow", table_name="workflow_result_objects")
    op.drop_table("workflow_result_objects")

    op.drop_index("ix_wf_node_outputs_execution", table_name="workflow_node_outputs")
    op.drop_table("workflow_node_outputs")

    op.drop_index("ix_workflow_executions_started", table_name="workflow_executions")
    op.drop_index("ix_workflow_executions_workflow", table_name="workflow_executions")
    op.drop_table("workflow_executions")

    op.drop_constraint("uq_result_object_defs_terminate_node", "result_object_definitions", type_="unique")
    op.drop_index("ix_result_object_defs_workflow", table_name="result_object_definitions")
    op.drop_table("result_object_definitions")

    op.drop_index("ix_workflow_edges_target", table_name="workflow_edges")
    op.drop_index("ix_workflow_edges_source", table_name="workflow_edges")
    op.drop_index("ix_workflow_edges_workflow_id", table_name="workflow_edges")
    op.drop_table("workflow_edges")

    op.drop_index("ix_workflow_nodes_type", table_name="workflow_nodes")
    op.drop_index("ix_workflow_nodes_workflow_id", table_name="workflow_nodes")
    op.drop_table("workflow_nodes")

    op.drop_index("ix_workflows_customer_site", table_name="workflows")
    op.drop_index("ix_workflows_site_id", table_name="workflows")
    op.drop_constraint("fk_workflows_created_by_user_id_users", "workflows", type_="foreignkey")
    op.drop_constraint("fk_workflows_site_id_sites", "workflows", type_="foreignkey")
    op.drop_column("workflows", "created_by_user_id")
    op.drop_column("workflows", "is_published")
    op.drop_column("workflows", "version")
    op.drop_column("workflows", "description")
    op.drop_column("workflows", "site_id")
