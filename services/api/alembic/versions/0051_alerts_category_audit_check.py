"""Allow alerts.category = audit (functional audit emitters; aligns DB with app.core.alert_category).

Revision ID: 0051_alerts_category_audit_check
Revises: 0050_ota_campaign_simulator_poll_token
"""

from __future__ import annotations

from typing import Union

from alembic import op

revision: str = "0051_alerts_category_audit_check"
down_revision: Union[str, None] = "0050_ota_campaign_simulator_poll_token"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_alerts_category", "alerts", type_="check")
    op.create_check_constraint(
        "ck_alerts_category",
        "alerts",
        "category IN ("
        "'ingest','scrubber','workflow','publish','dashboard',"
        "'monitoring','ai','device_health','system','audit')",
    )


def downgrade() -> None:
    op.execute("UPDATE alerts SET category = 'system' WHERE lower(trim(category)) = 'audit'")
    op.drop_constraint("ck_alerts_category", "alerts", type_="check")
    op.create_check_constraint(
        "ck_alerts_category",
        "alerts",
        "category IN ("
        "'ingest','scrubber','workflow','publish','dashboard',"
        "'monitoring','ai','device_health','system')",
    )
