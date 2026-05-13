"""OTA executor pull queue, claim/lease, firmware_artifacts, target progress + idempotency.

Revision ID: 0049_ota_executor_artifacts
Revises: 0048_latest_device_state_system_json
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

revision: str = "0049_ota_executor_artifacts"
down_revision: Union[str, None] = "0048_latest_device_state_system_json"
branch_labels = None
depends_on = None

EXECUTOR_PERMS = (
    ("ota.executor.read", "Poll OTA executor work queue"),
    ("ota.executor.claim", "Claim OTA campaign targets for execution"),
    ("ota.executor.progress", "Report non-terminal OTA progress"),
    ("ota.executor.status", "Report terminal OTA target status"),
)


def upgrade() -> None:
    op.create_table(
        "firmware_artifacts",
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
        sa.Column("artifact_url", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(length=128), nullable=False),
        sa.Column("signature", sa.Text(), nullable=True),
        sa.Column("signature_algorithm", sa.String(length=64), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("release_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_firmware_artifacts_customer_id", "firmware_artifacts", ["customer_id"])
    op.create_index("ix_firmware_artifacts_site_id", "firmware_artifacts", ["site_id"])

    op.create_foreign_key(
        "fk_ota_campaigns_firmware_artifact",
        "ota_campaigns",
        "firmware_artifacts",
        ["artifact_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column("ota_campaign_targets", sa.Column("claimed_by", sa.String(length=255), nullable=True))
    op.add_column("ota_campaign_targets", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ota_campaign_targets", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ota_campaign_targets", sa.Column("progress_phase", sa.String(length=32), nullable=True))
    op.add_column("ota_campaign_targets", sa.Column("reported_ota_external_ref", sa.String(length=255), nullable=True))
    op.add_column("ota_campaign_targets", sa.Column("status_idempotency_key", sa.String(length=512), nullable=True))

    op.create_index(
        "ix_ota_campaign_targets_work_queue",
        "ota_campaign_targets",
        ["status", "campaign_id", "id"],
    )

    conn = op.get_bind()
    for pk, desc in EXECUTOR_PERMS:
        conn.execute(
            text(
                "INSERT INTO permissions (id, permission_key, description) "
                "SELECT gen_random_uuid(), :pk, :d "
                "WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_key = :pk)"
            ),
            {"pk": pk, "d": desc},
        )

    conn.execute(
        text(
            """
            INSERT INTO roles (id, role_key, name, description)
            SELECT gen_random_uuid(), 'ota_executor', 'OTA executor', 'Service principal for external OTA delivery (poll, claim, progress, status).'
            WHERE NOT EXISTS (SELECT 1 FROM roles WHERE role_key = 'ota_executor')
            """
        )
    )
    for pk, _desc in EXECUTOR_PERMS:
        conn.execute(
            text(
                """
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.id, p.id
                FROM roles r
                JOIN permissions p ON p.permission_key = :pk
                WHERE r.role_key = 'ota_executor'
                ON CONFLICT (role_id, permission_id) DO NOTHING
                """
            ),
            {"pk": pk},
        )


def downgrade() -> None:
    op.drop_index("ix_ota_campaign_targets_work_queue", table_name="ota_campaign_targets")
    op.drop_column("ota_campaign_targets", "status_idempotency_key")
    op.drop_column("ota_campaign_targets", "reported_ota_external_ref")
    op.drop_column("ota_campaign_targets", "progress_phase")
    op.drop_column("ota_campaign_targets", "lease_expires_at")
    op.drop_column("ota_campaign_targets", "claimed_at")
    op.drop_column("ota_campaign_targets", "claimed_by")

    op.drop_constraint("fk_ota_campaigns_firmware_artifact", "ota_campaigns", type_="foreignkey")

    op.drop_index("ix_firmware_artifacts_site_id", table_name="firmware_artifacts")
    op.drop_index("ix_firmware_artifacts_customer_id", table_name="firmware_artifacts")
    op.drop_table("firmware_artifacts")

    conn = op.get_bind()
    conn.execute(
        text(
            """
            DELETE FROM role_permissions rp
            USING permissions p, roles r
            WHERE rp.permission_id = p.id
              AND rp.role_id = r.id
              AND r.role_key = 'ota_executor'
              AND p.permission_key = ANY(CAST(:keys AS text[]))
            """
        ),
        {"keys": [k for k, _ in EXECUTOR_PERMS]},
    )
    conn.execute(text("DELETE FROM roles WHERE role_key = 'ota_executor'"))
    conn.execute(
        text("DELETE FROM permissions WHERE permission_key = ANY(CAST(:keys AS text[]))"),
        {"keys": [k for k, _ in EXECUTOR_PERMS]},
    )
