"""OTA campaigns (Phase 4), routing + candidate lane tables (Phase 7).

Revision ID: 0042_ota_campaigns_routing_candidate
Revises: 0041_device_versions_and_lineage_events
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042_ota_campaigns_routing_candidate"
down_revision: Union[str, None] = "0041_device_versions_and_lineage_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device_versions",
        sa.Column("routing_lane", sa.String(length=16), nullable=False, server_default="shared"),
    )
    op.add_column("device_versions", sa.Column("compatibility", sa.String(length=32), nullable=True))
    op.alter_column("device_versions", "routing_lane", server_default=None)

    op.create_table(
        "ota_campaigns",
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
            nullable=True,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("artifact_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_firmware_version", sa.String(length=128), nullable=True),
        sa.Column(
            "target_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("rollout_strategy", sa.Text(), nullable=True),
        sa.Column("approval_status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "approved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_ota_campaigns_customer_id", "ota_campaigns", ["customer_id"])
    op.create_index("ix_ota_campaigns_site_id", "ota_campaigns", ["site_id"])

    op.create_table(
        "ota_campaign_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "campaign_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ota_campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resolved_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resolved_devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "previous_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "target_device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("current_firmware_version", sa.String(length=128), nullable=True),
        sa.Column("target_firmware_version", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("progress_pct", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.Column("failure_message", sa.Text(), nullable=True),
        sa.Column("last_status_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("external_command_id", sa.String(length=255), nullable=True),
    )
    op.create_index("ix_ota_campaign_targets_campaign_id", "ota_campaign_targets", ["campaign_id"])
    op.create_index("ix_ota_campaign_targets_device_id", "ota_campaign_targets", ["device_id"])
    op.create_index("ix_ota_campaign_targets_resolved_device_id", "ota_campaign_targets", ["resolved_device_id"])

    op.create_table(
        "ota_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "campaign_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ota_campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ota_campaign_targets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_ota_events_campaign_id", "ota_events", ["campaign_id"])

    op.create_table(
        "candidate_latest_device_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "resolved_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resolved_devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
            "identity_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "display_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "kpi_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("health_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("location_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "scrubbed_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("scrubbed_events.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("resolved_device_id", name="uq_candidate_lds_resolved_device"),
    )

    op.create_table(
        "candidate_scrubbed_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resolved_device_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resolved_devices.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_candidate_scrubbed_device_version", "candidate_scrubbed_events", ["device_version_id"])

    op.create_table(
        "candidate_workflow_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "device_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("device_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workflow_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workflows.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("payload_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_candidate_wf_results_device_version", "candidate_workflow_results", ["device_version_id"])


def downgrade() -> None:
    op.drop_index("ix_candidate_wf_results_device_version", table_name="candidate_workflow_results")
    op.drop_table("candidate_workflow_results")
    op.drop_index("ix_candidate_scrubbed_device_version", table_name="candidate_scrubbed_events")
    op.drop_table("candidate_scrubbed_events")
    op.drop_table("candidate_latest_device_state")
    op.drop_index("ix_ota_events_campaign_id", table_name="ota_events")
    op.drop_table("ota_events")
    op.drop_index("ix_ota_campaign_targets_resolved_device_id", table_name="ota_campaign_targets")
    op.drop_index("ix_ota_campaign_targets_device_id", table_name="ota_campaign_targets")
    op.drop_index("ix_ota_campaign_targets_campaign_id", table_name="ota_campaign_targets")
    op.drop_table("ota_campaign_targets")
    op.drop_index("ix_ota_campaigns_site_id", table_name="ota_campaigns")
    op.drop_index("ix_ota_campaigns_customer_id", table_name="ota_campaigns")
    op.drop_table("ota_campaigns")
    op.drop_column("device_versions", "compatibility")
    op.drop_column("device_versions", "routing_lane")
