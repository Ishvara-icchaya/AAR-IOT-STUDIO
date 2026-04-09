"""TimescaleDB hypertables for histories and metrics.

Revision ID: ts0001
Revises:
Create Date: 2026-04-05

"""

from typing import Sequence, Union

from alembic import op

revision: str = "ts0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS data_object_history (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            device_id UUID,
            data_object_id UUID,
            record JSONB NOT NULL,
            PRIMARY KEY (time, id)
        );
        """
    )
    op.execute(
        "SELECT create_hypertable('data_object_history', 'time', if_not_exists => TRUE);"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS workflow_object_history (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            workflow_id UUID,
            record JSONB NOT NULL,
            PRIMARY KEY (time, id)
        );
        """
    )
    op.execute(
        "SELECT create_hypertable('workflow_object_history', 'time', if_not_exists => TRUE);"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS result_object_history (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            workflow_id UUID,
            record JSONB NOT NULL,
            PRIMARY KEY (time, id)
        );
        """
    )
    op.execute(
        "SELECT create_hypertable('result_object_history', 'time', if_not_exists => TRUE);"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS kpi_history (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            device_id UUID,
            kpi_key TEXT NOT NULL,
            value DOUBLE PRECISION,
            record JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (time, id)
        );
        """
    )
    op.execute("SELECT create_hypertable('kpi_history', 'time', if_not_exists => TRUE);")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS health_history (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            device_id UUID,
            record JSONB NOT NULL,
            PRIMARY KEY (time, id)
        );
        """
    )
    op.execute("SELECT create_hypertable('health_history', 'time', if_not_exists => TRUE);")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS monitoring_metrics (
            id BIGSERIAL,
            time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            metric_key TEXT NOT NULL,
            value DOUBLE PRECISION,
            labels JSONB NOT NULL DEFAULT '{}'::jsonb,
            PRIMARY KEY (time, id)
        );
        """
    )
    op.execute(
        "SELECT create_hypertable('monitoring_metrics', 'time', if_not_exists => TRUE);"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS monitoring_metrics CASCADE")
    op.execute("DROP TABLE IF EXISTS health_history CASCADE")
    op.execute("DROP TABLE IF EXISTS kpi_history CASCADE")
    op.execute("DROP TABLE IF EXISTS result_object_history CASCADE")
    op.execute("DROP TABLE IF EXISTS workflow_object_history CASCADE")
    op.execute("DROP TABLE IF EXISTS data_object_history CASCADE")
