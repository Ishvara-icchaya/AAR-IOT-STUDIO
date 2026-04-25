"""Evidence packaging for transparency and UI."""

from __future__ import annotations

from typing import Any


def build_evidence(
    *,
    datasets: list[str],
    rows_returned: int,
    time_range_label: str | None,
    time_window_utc: dict[str, str] | None = None,
    filters: dict[str, Any],
    warnings: list[str],
    source_hints: list[str] | None = None,
    rows_clamped: bool = False,
    span_clamped: bool = False,
) -> dict[str, Any]:
    ev: dict[str, Any] = {
        "datasets": datasets,
        "rows_returned": rows_returned,
        "time_range": time_range_label,
        "filters_applied": {k: v for k, v in (filters or {}).items() if k != "site_ids" or v},
        "warnings": list(warnings or []),
        "rows_clamped": rows_clamped,
        "span_clamped": span_clamped,
    }
    if time_window_utc:
        ev["time_window_utc"] = time_window_utc
    if source_hints:
        ev["source_pages"] = source_hints
    return ev


def hints_for_dataset(dataset: str) -> list[str]:
    m = {
        "ai_alerts_recent": ["/alerts", "Alerts & Notifications"],
        "ai_data_objects_latest": ["/scrubber/raw-select", "Raw sample (archived payloads)"],
        "ai_devices": ["/devices/manage", "Devices"],
        "ai_sites": ["/administration/sites", "Sites"],
        "ai_workflow_results_latest": ["/workflow/list", "Workflows"],
        "ai_workflow_executions_recent": ["/workflow/list", "Workflow executions"],
        "ai_dashboards": ["/dashboard/list", "Dashboards"],
        "ai_monitoring_overview": ["/administration/monitoring", "Monitoring"],
        "ai_published_services": ["/published-services", "Published services"],
        "ai_kpi_snapshot": ["/dashboard/list", "KPI snapshot (dashboards)"],
        "ai_kpi_trends": ["/dashboard/list", "KPI trends (dashboards)"],
        "ai_health_trends": ["/devices/manage", "Device health history (Timescale health_history)"],
        "ai_publish_delivery_trends": ["/published-services", "Published service delivery logs"],
    }
    return m.get(dataset, [])
