"""Map object KPI durable history (hypertable).

Revision ID: ts0002
Revises: ts0001
Create Date: 2026-04-09

"""

from typing import Sequence, Union

from alembic import op

revision: str = "ts0002"
down_revision: Union[str, None] = "ts0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS map_object_kpi_history (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            object_kind TEXT NOT NULL,
            object_id UUID NOT NULL,
            kpi_key TEXT NOT NULL,
            value DOUBLE PRECISION,
            record JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (time, id)
        );
        """
    )
    op.execute(
        "SELECT create_hypertable('map_object_kpi_history', 'time', if_not_exists => TRUE);"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_map_obj_kpi_cust_kind_obj_time
        ON map_object_kpi_history (customer_id, object_kind, object_id, time DESC);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS map_object_kpi_history CASCADE")
