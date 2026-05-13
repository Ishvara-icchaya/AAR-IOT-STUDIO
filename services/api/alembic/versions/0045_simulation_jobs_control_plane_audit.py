"""Phase 10 replay simulation jobs + Phase 13 control-plane audit events.

Revision ID: 0045_simulation_jobs_control_plane_audit
Revises: 0044_ota_operator_campaign_perms
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0045_simulation_jobs_control_plane_audit"
down_revision: Union[str, None] = "0044_ota_operator_campaign_perms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "simulation_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "customer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "baseline_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "candidate_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="200"),
        sa.Column("records_tested", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("records_passed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("records_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="completed"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("result_json", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_simulation_jobs_customer_id", "simulation_jobs", ["customer_id"])
    op.create_index("ix_simulation_jobs_site_id", "simulation_jobs", ["site_id"])
    op.create_index("ix_simulation_jobs_device_id", "simulation_jobs", ["device_id"])
    op.create_index("ix_simulation_jobs_created_at", "simulation_jobs", ["created_at"])

    op.create_table(
        "control_plane_audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "customer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "site_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action_type", sa.String(length=64), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("correlation_id", sa.String(length=255), nullable=True),
        sa.Column("payload_json", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_cp_audit_customer_created", "control_plane_audit_events", ["customer_id", "created_at"])
    op.create_index("ix_cp_audit_site_created", "control_plane_audit_events", ["site_id", "created_at"])
    op.create_index("ix_cp_audit_action", "control_plane_audit_events", ["action_type"])


def downgrade() -> None:
    op.drop_index("ix_cp_audit_action", table_name="control_plane_audit_events")
    op.drop_index("ix_cp_audit_site_created", table_name="control_plane_audit_events")
    op.drop_index("ix_cp_audit_customer_created", table_name="control_plane_audit_events")
    op.drop_table("control_plane_audit_events")
    op.drop_index("ix_simulation_jobs_created_at", table_name="simulation_jobs")
    op.drop_index("ix_simulation_jobs_device_id", table_name="simulation_jobs")
    op.drop_index("ix_simulation_jobs_site_id", table_name="simulation_jobs")
    op.drop_index("ix_simulation_jobs_customer_id", table_name="simulation_jobs")
    op.drop_table("simulation_jobs")
