"""Deterministic intent classification (no LLM) — execution never trusts user text alone."""

from __future__ import annotations

import re
from typing import Any

# Intents aligned with Enterprise AI hardening spec
INTENTS = frozenset(
    {
        "health_summary",
        "alert_summary",
        "device_lookup",
        "site_lookup",
        "kpi_trend",
        "workflow_result_lookup",
        "dashboard_summary",
        "monitoring_summary",
        "comparative_analysis",
        "report_generation",
        "workflow_execution_lookup",
        "published_service_lookup",
        "publish_delivery_trend",
        "health_trend",
        "raw_debug",
        "data_object_catalog",
        "unsupported",
    }
)


def _wants_raw_debug(text: str) -> bool:
    t = text.lower()
    return bool(
        re.search(
            r"\b(raw|payload|debug|sql|schema|ddl|truncate|drop table|union select)\b",
            t,
            re.I,
        )
    )


def classify_intent(message: str) -> dict[str, Any]:
    msg = (message or "").strip()
    low = msg.lower()

    if not msg:
        return {
            "intent": "unsupported",
            "time_range": None,
            "site_scope": [],
            "needs_llm": False,
            "needs_raw_access": False,
            "notes": "empty_message",
        }

    if "__healthcheck__" in low:
        return {
            "intent": "monitoring_summary",
            "time_range": "last_24_hours",
            "site_scope": [],
            "needs_llm": False,
            "needs_raw_access": False,
            "notes": "healthcheck",
        }

    needs_raw = _wants_raw_debug(msg)

    if any(k in low for k in ("monitoring", "kafka", "redis lag", "queue lag", "ollama", "worker heartbeat")):
        intent = "monitoring_summary"
    elif any(k in low for k in ("critical alert", "alert", "unacknowledged", "notification")):
        intent = "alert_summary"
    elif "dashboard" in low:
        intent = "dashboard_summary"
    elif any(k in low for k in ("workflow result", "result object")):
        intent = "workflow_result_lookup"
    elif any(k in low for k in ("workflow run", "workflow execution", "failed workflow", "execution")):
        intent = "workflow_execution_lookup"
    elif any(
        k in low
        for k in (
            "publish failure trend",
            "delivery log",
            "publish trend",
            "failed most",
            "failure rate",
            "delivery failures",
            "unstable endpoint",
            "most unstable",
        )
    ) or ("publish" in low and "failure" in low and ("trend" in low or "today" in low or "week" in low)):
        intent = "publish_delivery_trend"
    elif any(k in low for k in ("published service", "mqtt publish", "rest publish")):
        intent = "published_service_lookup"
    elif re.search(r"\b(fleet|trucks?|truck|vehicle|vehicles)\b", low) and re.search(
        r"\b(license\s+plates?|plate\s+numbers?|registration|vehicle\s+ids?|\bvin\b)\b",
        low,
    ):
        # Fleet identity lives in ingested data objects (KPI/payload), not IoT platform Device rows.
        intent = "data_object_catalog"
    elif re.search(
        r"\b(license\s+plates?|plate\s+numbers?|registration(\s+numbers?)?|vehicle\s+ids?|vin)\b",
        low,
    ) or any(
        phrase in low
        for phrase in (
            "which trucks",
            "list of trucks",
            "all the trucks",
            "every truck",
            "truck names",
            "vehicle names",
            "names of the trucks",
            "identifiers for",
        )
    ):
        # Roster / identity without fleet context: platform Device list (name, description, …).
        intent = "device_lookup"
    elif any(
        k in low
        for k in (
            "fleet",
            "truck",
            "trucks",
            "fuel",
            "fuel usage",
            "vehicle",
            "vehicles",
        )
    ) or ("summary" in low and "fleet" in low):
        # Operational / telemetry questions map to KPI trends (Timescale kpi_history); domain terms are not executed as raw SQL.
        intent = "kpi_trend"
    elif any(k in low for k in ("device", "endpoint", "polling")):
        intent = "device_lookup"
    elif re.search(r"\b(data objects?|ingested objects?)\b", low) and re.search(
        r"\b(unhealthy|degraded|health|yellow|red|green|status)\b",
        low,
    ):
        # Data-object health questions must not be captured by the site list branch ("sites" contains "site").
        intent = "health_summary"
    elif re.search(r"\b(sites?|corridors?|facilities?)\b", low):
        intent = "site_lookup"
    elif ("health" in low or "device health" in low) and (
        any(
            k in low
            for k in (
                "trend",
                "declining",
                "decline",
                "worse",
                "worsening",
                "over time",
                "7 day",
                "30 day",
                "week",
                "hourly",
                "daily",
            )
        )
        or any(k in low for k in ("yellow", "red"))
    ):
        intent = "health_trend"
    elif any(k in low for k in ("kpi", "metric", "trend")):
        intent = "kpi_trend"
    elif any(k in low for k in ("compare", "versus", "vs ", " which site")):
        intent = "comparative_analysis"
    elif any(k in low for k in ("report", "executive summary", "writeup")):
        intent = "report_generation"
    elif any(k in low for k in ("health", "unhealthy", "degraded", "status summary")):
        intent = "health_summary"
    else:
        intent = "unsupported"

    if needs_raw:
        intent = "raw_debug"

    tr = "last_24_hours"
    if "7 day" in low or "week" in low:
        tr = "last_7_days"
    if "30 day" in low or "month" in low:
        tr = "last_30_days"

    needs_llm = intent in {
        "report_generation",
        "comparative_analysis",
        "dashboard_summary",
        "monitoring_summary",
        "alert_summary",
        "health_summary",
        "health_trend",
        "kpi_trend",
        "publish_delivery_trend",
        "data_object_catalog",
    }

    return {
        "intent": intent if intent in INTENTS else "unsupported",
        "time_range": tr,
        "site_scope": [],
        "needs_llm": needs_llm,
        "needs_raw_access": needs_raw and intent == "raw_debug",
        "notes": None,
    }
