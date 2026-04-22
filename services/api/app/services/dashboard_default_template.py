"""Default Operations Overview layout (seeded on create / reset; used as synthetic layout shell)."""

from __future__ import annotations

import uuid
from typing import Any


def default_ops_template_layout(*, site_id: uuid.UUID) -> dict[str, Any]:
    """Reference dashboard: KPIs, alert trends, then alerts / activity / devices in one row."""
    _ = site_id
    wid_kpi = str(uuid.uuid4())
    wid_trends = str(uuid.uuid4())
    wid_alerts = str(uuid.uuid4())
    wid_act = str(uuid.uuid4())
    wid_tbl = str(uuid.uuid4())
    return {
        "version": 1,
        "settings": {"refreshIntervalSec": 30},
        "rows": [
            {
                "rowId": str(uuid.uuid4()),
                "columns": [
                    {
                        "columnId": str(uuid.uuid4()),
                        "span": 12,
                        "widget": {
                            "widgetId": wid_kpi,
                            "type": "ops_overview_kpis",
                            "title": "Device summary",
                            "binding": {},
                            "config": {},
                        },
                    }
                ],
            },
            {
                "rowId": str(uuid.uuid4()),
                "columns": [
                    {
                        "columnId": str(uuid.uuid4()),
                        "span": 12,
                        "widget": {
                            "widgetId": wid_trends,
                            "type": "ops_alert_trends",
                            "title": "Alert trends (warning vs critical)",
                            "binding": {},
                            "config": {"numDays": 7},
                        },
                    }
                ],
            },
            {
                "rowId": str(uuid.uuid4()),
                "columns": [
                    {
                        "columnId": str(uuid.uuid4()),
                        "span": 4,
                        "widget": {
                            "widgetId": wid_alerts,
                            "type": "ops_recent_alerts",
                            "title": "Recent alerts",
                            "binding": {},
                            "config": {"limit": 48, "pageSize": 6},
                        },
                    },
                    {
                        "columnId": str(uuid.uuid4()),
                        "span": 4,
                        "widget": {
                            "widgetId": wid_act,
                            "type": "ops_recent_activity",
                            "title": "Recent activity",
                            "binding": {},
                            "config": {"limit": 48, "pageSize": 6},
                        },
                    },
                    {
                        "columnId": str(uuid.uuid4()),
                        "span": 4,
                        "widget": {
                            "widgetId": wid_tbl,
                            "type": "ops_device_table",
                            "title": "Device status",
                            "binding": {},
                            "config": {"limit": 40, "pageSize": 8},
                        },
                    },
                ],
            },
        ],
    }
