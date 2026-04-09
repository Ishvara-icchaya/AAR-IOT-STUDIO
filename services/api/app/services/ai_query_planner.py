"""Build a structured plan from intent + request (never raw SQL from user text)."""

from __future__ import annotations

import uuid
from typing import Any


def _dataset_for_intent(intent: str) -> tuple[str, str, int]:
    """Returns dataset, aggregation, default_limit scale."""
    m: dict[str, tuple[str, str, int]] = {
        "alert_summary": ("ai_alerts_recent", "count_by_severity", 50),
        "comparative_analysis": ("ai_alerts_recent", "count_by_category", 80),
        "report_generation": ("ai_alerts_recent", "count_by_category", 60),
        "health_summary": ("ai_data_objects_latest", "count_by_health", 40),
        "device_lookup": ("ai_devices", "none", 100),
        "site_lookup": ("ai_sites", "none", 80),
        "kpi_trend": ("ai_kpi_trends", "daily_avg_by_key", 200),
        "workflow_result_lookup": ("ai_workflow_results_latest", "count_by_health", 40),
        "workflow_execution_lookup": ("ai_workflow_executions_recent", "count_by_status", 40),
        "dashboard_summary": ("ai_dashboards", "count_by_status", 50),
        "monitoring_summary": ("ai_monitoring_overview", "none", 1),
        "published_service_lookup": ("ai_published_services", "count_by_status", 40),
        "publish_delivery_trend": ("ai_publish_delivery_trends", "failure_rate_by_service", 120),
        "health_trend": ("ai_health_trends", "daily_status_counts", 200),
        "raw_debug": ("ai_data_objects_latest", "none", 20),
        "unsupported": ("ai_alerts_recent", "none", 5),
    }
    return m.get(intent, ("ai_alerts_recent", "none", 20))


def build_plan(
    *,
    intent_payload: dict[str, Any],
    message: str,
    site_ids: list[uuid.UUID],
    time_range: str | None,
    use_llm: bool,
    debug_raw: bool,
    user_role: str,
) -> dict[str, Any]:
    intent = str(intent_payload.get("intent") or "unsupported")
    dataset, aggregation, base_limit = _dataset_for_intent(intent)

    tr_norm = (time_range or intent_payload.get("time_range") or "last_24_hours")
    tr_norm = str(tr_norm).lower().replace(" ", "_")

    if intent == "kpi_trend":
        dataset = "ai_kpi_trends"
        if tr_norm in ("last_7_days", "last_7d", "week", "last_30_days", "last_30d", "month"):
            aggregation = "daily_avg_by_key"
            base_limit = 250
        else:
            aggregation = "hourly_avg_by_key"
            base_limit = 168

    if intent == "health_trend":
        dataset = "ai_health_trends"
        ml = message.lower()
        long_window = tr_norm in ("last_7_days", "last_7d", "week", "last_30_days", "last_30d", "month")
        if "recent" in ml or "sample point" in ml:
            aggregation = "recent_points"
            base_limit = 100
        elif long_window:
            aggregation = "daily_avg_score" if any(x in ml for x in ("score", "avg", "average")) else "daily_status_counts"
            base_limit = 250
        else:
            aggregation = "hourly_avg_score" if any(x in ml for x in ("score", "avg", "average")) else "hourly_status_counts"
            base_limit = 168

    if intent == "publish_delivery_trend":
        dataset = "ai_publish_delivery_trends"
        ml = message.lower()
        if "hour" in ml or "today" in ml:
            aggregation = "hourly_failures"
            base_limit = 168
        elif "status" in ml or "count" in ml:
            aggregation = "count_by_status"
            base_limit = 80
        else:
            aggregation = "failure_rate_by_service"
            base_limit = 120

    filters: dict[str, Any] = {"site_ids": [str(s) for s in site_ids]}
    if intent in ("alert_summary", "comparative_analysis", "report_generation"):
        if any(x in message.lower() for x in ("critical", "severity")):
            filters["severity"] = ["critical", "warning"]
        filters["acknowledged"] = False
    if intent == "workflow_execution_lookup" and "fail" in message.lower():
        filters["status"] = ["failed", "error"]

    if intent == "kpi_trend":
        # Optional single-metric hint from natural language (still bounded in sanitizer).
        for token in ("temperature", "temp", "humidity", "pressure", "voltage", "current"):
            if token in message.lower():
                filters["kpi_keys"] = [token if token != "temp" else "temperature"]
                break

    include_payload = bool(
        debug_raw and user_role == "admin" and intent == "raw_debug"
    )

    needs_llm = bool(intent_payload.get("needs_llm")) and use_llm
    if intent == "unsupported":
        dataset = "ai_alerts_recent"
        aggregation = "none"
        base_limit = 5

    return {
        "dataset": dataset,
        "filters": filters,
        "time_range": {"preset": tr_norm},
        "limit": base_limit,
        "aggregation": aggregation,
        "include_payload": include_payload,
        "intent": intent,
        "needs_llm": needs_llm,
        "user_message_excerpt": message[:2000],
    }
