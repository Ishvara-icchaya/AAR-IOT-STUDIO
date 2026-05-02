"""Validate plans against the dataset registry (defense in depth)."""

from __future__ import annotations

import uuid
from typing import Any

from app.services.ai_dataset_registry import get_dataset


class PlanRejected(Exception):
    pass


def _parse_site_ids(raw: Any) -> list[uuid.UUID]:
    if not raw:
        return []
    out: list[uuid.UUID] = []
    for x in raw:
        try:
            out.append(uuid.UUID(str(x)))
        except ValueError as e:
            raise PlanRejected(f"invalid site id: {x}") from e
    return out


def _parse_device_ids(raw: Any) -> list[uuid.UUID]:
    if not raw:
        return []
    if not isinstance(raw, list):
        return []
    out: list[uuid.UUID] = []
    for x in raw:
        try:
            out.append(uuid.UUID(str(x)))
        except ValueError as e:
            raise PlanRejected(f"invalid device id: {x}") from e
    return out


def validate_and_clamp_plan(plan: dict[str, Any], *, user_role: str) -> dict[str, Any]:
    name = plan.get("dataset")
    if not isinstance(name, str):
        raise PlanRejected("missing dataset")
    spec = get_dataset(name)
    if not spec:
        raise PlanRejected(f"unknown dataset: {name}")

    if user_role not in spec.allowed_roles and user_role != "admin":
        raise PlanRejected("role cannot access dataset")

    lim = plan.get("limit")
    if not isinstance(lim, int) or lim < 1:
        lim = spec.default_limit
    lim = min(lim, spec.max_limit)

    agg = plan.get("aggregation") or "none"
    if agg not in spec.allowed_aggregations:
        if name == "ai_kpi_trends":
            agg = "daily_avg_by_key"
        elif name == "ai_health_trends":
            agg = "daily_status_counts"
        elif name == "ai_publish_delivery_trends":
            agg = "failure_rate_by_service"
        else:
            agg = "none"

    filters = plan.get("filters")
    if not isinstance(filters, dict):
        filters = {}
    cleaned: dict[str, Any] = {}
    for k, v in filters.items():
        if k not in spec.allowed_filter_keys:
            continue
        cleaned[k] = v

    site_ids = _parse_site_ids(cleaned.get("site_ids"))
    cleaned["site_ids"] = [str(s) for s in site_ids]

    if name == "ai_kpi_trends" and cleaned.get("device_ids") is not None:
        dev_ids = _parse_device_ids(cleaned.get("device_ids"))
        cleaned["device_ids"] = [str(d) for d in dev_ids]

    if name == "ai_publish_delivery_trends" and cleaned.get("published_service_id"):
        try:
            cleaned["published_service_id"] = str(uuid.UUID(str(cleaned["published_service_id"])))
        except (ValueError, TypeError):
            cleaned.pop("published_service_id", None)

    include_payload = bool(plan.get("include_payload"))
    if include_payload and not spec.allow_payload:
        if user_role != "admin" or name != "ai_data_objects_latest":
            include_payload = False

    out = {
        **plan,
        "dataset": name,
        "limit": lim,
        "aggregation": agg,
        "filters": cleaned,
        "include_payload": include_payload,
    }
    return out
