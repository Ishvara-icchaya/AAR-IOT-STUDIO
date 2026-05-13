"""Allow informational alert severity (DML / audit events, no incident level).

Revision ID: 0035_informational_alert
Revises: 0034_device_import_audit
"""

from __future__ import annotations

from typing import Union

from alembic import op

revision: str = "0035_informational_alert"
down_revision: Union[str, None] = "0034_device_import_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_alerts_severity", "alerts", type_="check")
    op.create_check_constraint(
        "ck_alerts_severity",
        "alerts",
        "severity IN ('info','warning','critical','informational')",
    )


def downgrade() -> None:
    op.execute("UPDATE alerts SET severity = 'info' WHERE lower(trim(severity)) = 'informational'")
    op.drop_constraint("ck_alerts_severity", "alerts", type_="check")
    op.create_check_constraint(
        "ck_alerts_severity",
        "alerts",
        "severity IN ('info','warning','critical')",
    )
