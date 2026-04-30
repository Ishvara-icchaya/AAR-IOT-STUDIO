"""Trend 5m metric buckets (hypertable) for durable rollup history.

Revision ID: ts0003
Revises: ts0002
Create Date: 2026-04-30

One row per (bucket_time, scope, entity_id, metric_key): UPSERT from workers
mirrors Redis 5m bucket stats for backfill, historical queries, and Redis rebuilds.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "ts0003"
down_revision: Union[str, None] = "ts0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS trend_metric_bucket (
            bucket_time TIMESTAMPTZ NOT NULL,
            customer_id UUID NOT NULL,
            site_id UUID NOT NULL,
            scope TEXT NOT NULL,
            entity_id UUID NOT NULL,
            metric_key TEXT NOT NULL,
            n INTEGER NOT NULL,
            sum DOUBLE PRECISION NOT NULL,
            sumsq DOUBLE PRECISION NOT NULL,
            min DOUBLE PRECISION,
            max DOUBLE PRECISION,
            avg DOUBLE PRECISION,
            stddev DOUBLE PRECISION,
            is_partial BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT trend_metric_bucket_scope_chk
                CHECK (scope IN ('rdev', 'endpoint', 'site')),
            CONSTRAINT trend_metric_bucket_pk PRIMARY KEY (bucket_time, scope, entity_id, metric_key)
        );
        """
    )
    op.execute(
        "SELECT create_hypertable('trend_metric_bucket', 'bucket_time', if_not_exists => TRUE);"
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_trend_metric_bucket_customer_site_time
        ON trend_metric_bucket (customer_id, site_id, bucket_time DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_trend_metric_bucket_scope_entity_metric_time
        ON trend_metric_bucket (scope, entity_id, metric_key, bucket_time DESC);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS trend_metric_bucket CASCADE")
