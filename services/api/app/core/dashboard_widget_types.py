"""Canonical dashboard widget type strings (single source of truth for API + builders).

See docs/DASHBOARD_WIDGET_CONTRACT.md. Do not introduce pluralization variants.
"""

from __future__ import annotations

# Sentinel types (not user-defined widgets)
INVALID_WIDGET_REFERENCE = "invalid_widget_reference"
UNSUPPORTED = "unsupported"

# Ops / system widgets
OPS_ALERT_TRENDS = "ops_alert_trends"
OPS_OVERVIEW_KPIS = "ops_overview_kpis"
OPS_DEVICE_TABLE = "ops_device_table"
OPS_RECENT_ACTIVITY = "ops_recent_activity"
OPS_RECENT_ALERTS = "ops_recent_alerts"

# Endpoint collection (v2 contract names; builders land incrementally)
ENDPOINT_COLLECTION_KPI = "endpoint_collection_kpi"
ENDPOINT_COLLECTION_TABLE = "endpoint_collection_table"
ENDPOINT_COLLECTION_TREND = "endpoint_collection_trend"
ENDPOINT_COLLECTION_SUMMARY = "endpoint_collection_summary"
LOCATION_HEADING_MAP = "location_heading_map"

# Legacy layout `type` values (stored JSON) → canonical widgetType
BLOCK_TYPE_TO_WIDGET_TYPE: dict[str, str] = {
    OPS_ALERT_TRENDS: OPS_ALERT_TRENDS,
    OPS_OVERVIEW_KPIS: OPS_OVERVIEW_KPIS,
    OPS_DEVICE_TABLE: OPS_DEVICE_TABLE,
    OPS_RECENT_ACTIVITY: OPS_RECENT_ACTIVITY,
    OPS_RECENT_ALERTS: OPS_RECENT_ALERTS,
    "text": "text",
    "kpi": ENDPOINT_COLLECTION_KPI,
    "table": ENDPOINT_COLLECTION_TABLE,
    "chart": ENDPOINT_COLLECTION_TREND,
    "summary": ENDPOINT_COLLECTION_SUMMARY,
    "health_summary": "health_summary",
    "alert_summary": "alert_summary",
    "site_summary": "site_summary",
    "device_tile": "device_tile",
    "map": LOCATION_HEADING_MAP,
    "fleet_map": LOCATION_HEADING_MAP,
    "location_heading_map": LOCATION_HEADING_MAP,
}


def canonical_widget_type(block_type: str) -> str:
    """Map stored layout widget `type` string to canonical widgetType."""
    bt = str(block_type or "").strip()
    if not bt:
        return UNSUPPORTED
    return BLOCK_TYPE_TO_WIDGET_TYPE.get(bt, UNSUPPORTED)
