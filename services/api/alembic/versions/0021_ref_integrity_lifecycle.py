"""Operational status columns + lifecycle indexes (referential integrity policy).

Revision ID: 0021_ref_integrity_lifecycle (≤32 chars for alembic_version.version_num)
Revises: 0020_static_ingestions

Note: `ix_data_objects_lifecycle_status` already exists (0004_data_objects_workflow_lifecycle).
`ix_published_services_status` already exists (0010_alerts_published_services_guide_alignment).
This revision is idempotent so a partially applied run can complete safely.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0021_ref_integrity_lifecycle"
down_revision: Union[str, None] = "0020_static_ingestions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_cols(table: str) -> set[str]:
    bind = op.get_bind()
    insp = inspect(bind)
    return {c["name"] for c in insp.get_columns(table)}


def _add_operational_status(table: str) -> None:
    if "operational_status" in _table_cols(table):
        return
    op.add_column(
        table,
        sa.Column("operational_status", sa.String(32), nullable=False, server_default="active"),
    )


def _create_index_if_not_exists(name: str, table: str, *columns: str) -> None:
    """PostgreSQL CREATE INDEX IF NOT EXISTS."""
    cols = ", ".join(columns)
    op.execute(sa.text(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({cols})'))


def upgrade() -> None:
    _add_operational_status("customers")
    _add_operational_status("sites")
    _add_operational_status("devices")
    _add_operational_status("users")
    _add_operational_status("device_objects")
    _add_operational_status("device_endpoints")
    _add_operational_status("workflow_result_objects")

    _create_index_if_not_exists("ix_customers_operational_status", "customers", "operational_status")
    _create_index_if_not_exists("ix_sites_operational_status", "sites", "operational_status")
    _create_index_if_not_exists("ix_devices_operational_status", "devices", "operational_status")
    _create_index_if_not_exists("ix_users_operational_status", "users", "operational_status")
    _create_index_if_not_exists("ix_device_objects_operational_status", "device_objects", "operational_status")
    _create_index_if_not_exists("ix_device_endpoints_operational_status", "device_endpoints", "operational_status")
    # ix_data_objects_lifecycle_status: already created in 0004 — do not recreate
    _create_index_if_not_exists("ix_workflows_lifecycle_status", "workflows", "lifecycle_status")
    _create_index_if_not_exists("ix_dashboards_status", "dashboards", "status")
    # ix_published_services_status: already created in 0010 — do not recreate
    _create_index_if_not_exists(
        "ix_workflow_result_objects_operational_status",
        "workflow_result_objects",
        "operational_status",
    )


def downgrade() -> None:
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_workflow_result_objects_operational_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_dashboards_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_workflows_lifecycle_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_device_endpoints_operational_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_device_objects_operational_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_users_operational_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_devices_operational_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_sites_operational_status"'))
    op.execute(sa.text('DROP INDEX IF EXISTS "ix_customers_operational_status"'))

    if "operational_status" in _table_cols("workflow_result_objects"):
        op.drop_column("workflow_result_objects", "operational_status")
    if "operational_status" in _table_cols("device_endpoints"):
        op.drop_column("device_endpoints", "operational_status")
    if "operational_status" in _table_cols("device_objects"):
        op.drop_column("device_objects", "operational_status")
    if "operational_status" in _table_cols("users"):
        op.drop_column("users", "operational_status")
    if "operational_status" in _table_cols("devices"):
        op.drop_column("devices", "operational_status")
    if "operational_status" in _table_cols("sites"):
        op.drop_column("sites", "operational_status")
    if "operational_status" in _table_cols("customers"):
        op.drop_column("customers", "operational_status")
