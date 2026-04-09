"""Normalize alert severity to info | warning | critical."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_alert_severity_normalize"
down_revision = "0008_alerts_pub_p1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE alerts SET severity = CASE
              WHEN lower(trim(severity)) IN ('info', 'information', 'low', 'green', 'debug', 'notice', 'ok', 'success')
                THEN 'info'
              WHEN lower(trim(severity)) IN (
                'warning', 'warn', 'medium', 'yellow', 'degraded', 'high', 'error', 'red', 'failed', 'failure'
              )
                THEN 'warning'
              WHEN lower(trim(severity)) IN ('critical', 'fatal', 'severe', 'emergency')
                THEN 'critical'
              ELSE 'warning'
            END
            """
        )
    )


def downgrade() -> None:
    pass
