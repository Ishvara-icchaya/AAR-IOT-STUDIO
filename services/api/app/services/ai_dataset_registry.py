"""Strict registry of datasets Enterprise AI may read (no user SQL)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, FrozenSet


@dataclass(frozen=True)
class DatasetSpec:
    name: str
    description: str
    default_limit: int
    max_limit: int
    allowed_roles: FrozenSet[str]
    allowed_filter_keys: FrozenSet[str]
    allowed_aggregations: FrozenSet[str]
    allow_payload: bool


# Roles: admin sees all; operator scoped by sites when registry enforces site filter.
ALL_ROLES = frozenset({"admin", "operator"})

DATASETS: dict[str, DatasetSpec] = {
    "ai_alerts_recent": DatasetSpec(
        name="ai_alerts_recent",
        description="Recent alerts for the customer, scoped by authorized sites.",
        default_limit=50,
        max_limit=200,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "severity", "acknowledged", "category"}),
        allowed_aggregations=frozenset({"none", "count_by_severity", "count_by_category"}),
        allow_payload=False,
    ),
    "ai_data_objects_latest": DatasetSpec(
        name="ai_data_objects_latest",
        description="Latest data objects (metadata; payload only in explicit debug mode for admins).",
        default_limit=40,
        max_limit=120,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "lifecycle_status", "health_status"}),
        allowed_aggregations=frozenset({"none", "count_by_health", "count_by_lifecycle"}),
        allow_payload=False,
    ),
    "ai_sites": DatasetSpec(
        name="ai_sites",
        description="Sites visible to the user within the customer.",
        default_limit=100,
        max_limit=500,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids"}),
        allowed_aggregations=frozenset({"none"}),
        allow_payload=False,
    ),
    "ai_devices": DatasetSpec(
        name="ai_devices",
        description="Devices for authorized sites.",
        default_limit=100,
        max_limit=400,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "is_active", "polling_enabled"}),
        allowed_aggregations=frozenset({"none", "count_by_site"}),
        allow_payload=False,
    ),
    "ai_kpi_snapshot": DatasetSpec(
        name="ai_kpi_snapshot",
        description="Data objects with KPI JSON keys (no Timescale series in Phase 1).",
        default_limit=30,
        max_limit=80,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids"}),
        allowed_aggregations=frozenset({"none", "kpi_key_frequency"}),
        allow_payload=False,
    ),
    "ai_kpi_trends": DatasetSpec(
        name="ai_kpi_trends",
        description="Timescale kpi_history series: bounded buckets, site-scoped via devices, read-only SQL.",
        default_limit=200,
        max_limit=500,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "kpi_keys"}),
        allowed_aggregations=frozenset({"hourly_avg_by_key", "daily_avg_by_key", "recent_points"}),
        allow_payload=False,
    ),
    "ai_health_trends": DatasetSpec(
        name="ai_health_trends",
        description="Timescale health_history: status distributions and numeric scores over time, site-scoped via devices.",
        default_limit=200,
        max_limit=500,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids"}),
        allowed_aggregations=frozenset(
            {
                "hourly_status_counts",
                "daily_status_counts",
                "hourly_avg_score",
                "daily_avg_score",
                "recent_points",
            }
        ),
        allow_payload=False,
    ),
    "ai_publish_delivery_trends": DatasetSpec(
        name="ai_publish_delivery_trends",
        description="Published service delivery logs: failures by hour, status counts, failure rate by service.",
        default_limit=120,
        max_limit=400,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "published_service_id"}),
        allowed_aggregations=frozenset({"count_by_status", "hourly_failures", "failure_rate_by_service"}),
        allow_payload=False,
    ),
    "ai_workflow_results_latest": DatasetSpec(
        name="ai_workflow_results_latest",
        description="Recent workflow result objects (metadata; payload optional debug).",
        default_limit=40,
        max_limit=120,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "health_status"}),
        allowed_aggregations=frozenset({"none", "count_by_health"}),
        allow_payload=False,
    ),
    "ai_workflow_executions_recent": DatasetSpec(
        name="ai_workflow_executions_recent",
        description="Recent workflow executions with status (customer-scoped).",
        default_limit=40,
        max_limit=120,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "status"}),
        allowed_aggregations=frozenset({"none", "count_by_status"}),
        allow_payload=False,
    ),
    "ai_dashboards": DatasetSpec(
        name="ai_dashboards",
        description="Dashboard definitions (name, status, site scope).",
        default_limit=50,
        max_limit=150,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "status"}),
        allowed_aggregations=frozenset({"none", "count_by_status"}),
        allow_payload=False,
    ),
    "ai_monitoring_overview": DatasetSpec(
        name="ai_monitoring_overview",
        description="Live monitoring summary (read-only service probes, not user SQL).",
        default_limit=1,
        max_limit=1,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset(set()),
        allowed_aggregations=frozenset({"none"}),
        allow_payload=False,
    ),
    "ai_published_services": DatasetSpec(
        name="ai_published_services",
        description="Published service rows (status, protocol summary).",
        default_limit=40,
        max_limit=100,
        allowed_roles=ALL_ROLES,
        allowed_filter_keys=frozenset({"site_ids", "status"}),
        allowed_aggregations=frozenset({"none", "count_by_status"}),
        allow_payload=False,
    ),
}


def dataset_public_meta() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for spec in DATASETS.values():
        out.append(
            {
                "name": spec.name,
                "description": spec.description,
                "default_limit": spec.default_limit,
                "max_limit": spec.max_limit,
                "allowed_filter_keys": sorted(spec.allowed_filter_keys),
                "allowed_aggregations": sorted(spec.allowed_aggregations),
            }
        )
    return sorted(out, key=lambda x: x["name"])


def get_dataset(name: str) -> DatasetSpec | None:
    return DATASETS.get(name)
