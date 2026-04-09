"""SQL guard / plan validation (no database)."""

from __future__ import annotations

import uuid

import pytest

from app.services.ai_query_planner import build_plan
from app.services.ai_sql_guard import PlanRejected, validate_and_clamp_plan


def test_unknown_dataset_rejected() -> None:
    with pytest.raises(PlanRejected, match="unknown dataset"):
        validate_and_clamp_plan({"dataset": "evil_drop_table"}, user_role="admin")


def test_invalid_filter_stripped_and_limit_clamped() -> None:
    sid = str(uuid.uuid4())
    plan = {
        "dataset": "ai_alerts_recent",
        "limit": 999_999,
        "aggregation": "count_by_severity",
        "filters": {"site_ids": [sid], "hacker": "1=1"},
        "include_payload": False,
    }
    out = validate_and_clamp_plan(plan, user_role="operator")
    assert "hacker" not in out["filters"]
    assert out["limit"] == 200
    assert out["filters"]["site_ids"] == [sid]


def test_excessive_limit_clamped_to_max() -> None:
    sid = str(uuid.uuid4())
    out = validate_and_clamp_plan(
        {
            "dataset": "ai_devices",
            "limit": 10_000,
            "aggregation": "none",
            "filters": {"site_ids": [sid]},
            "include_payload": False,
        },
        user_role="admin",
    )
    assert out["limit"] == 400


def test_invalid_aggregation_reset_for_alerts() -> None:
    sid = str(uuid.uuid4())
    out = validate_and_clamp_plan(
        {
            "dataset": "ai_alerts_recent",
            "limit": 10,
            "aggregation": "steal_passwords",
            "filters": {"site_ids": [sid]},
            "include_payload": False,
        },
        user_role="admin",
    )
    assert out["aggregation"] == "none"


def test_health_trends_invalid_aggregation_defaults() -> None:
    sid = str(uuid.uuid4())
    out = validate_and_clamp_plan(
        {
            "dataset": "ai_health_trends",
            "limit": 50,
            "aggregation": "drop_table",
            "filters": {"site_ids": [sid]},
            "include_payload": False,
        },
        user_role="operator",
    )
    assert out["aggregation"] == "daily_status_counts"


def test_publish_delivery_invalid_aggregation_defaults() -> None:
    sid = str(uuid.uuid4())
    out = validate_and_clamp_plan(
        {
            "dataset": "ai_publish_delivery_trends",
            "limit": 50,
            "aggregation": "evil",
            "filters": {"site_ids": [sid]},
            "include_payload": False,
        },
        user_role="operator",
    )
    assert out["aggregation"] == "failure_rate_by_service"


def test_kpi_trends_invalid_aggregation_defaults_to_daily() -> None:
    sid = str(uuid.uuid4())
    out = validate_and_clamp_plan(
        {
            "dataset": "ai_kpi_trends",
            "limit": 50,
            "aggregation": "invalid_agg",
            "filters": {"site_ids": [sid]},
            "include_payload": False,
        },
        user_role="operator",
    )
    assert out["aggregation"] == "daily_avg_by_key"


def test_planner_output_cannot_bypass_guard() -> None:
    intent_payload = {
        "intent": "kpi_trend",
        "time_range": "last_24_hours",
        "needs_llm": True,
        "needs_raw_access": False,
    }
    site = uuid.uuid4()
    plan = build_plan(
        intent_payload=intent_payload,
        message="kpi trend",
        site_ids=[site],
        time_range="last_24_hours",
        use_llm=True,
        debug_raw=False,
        user_role="operator",
    )
    plan["dataset"] = "not_a_registered_dataset"
    with pytest.raises(PlanRejected):
        validate_and_clamp_plan(plan, user_role="operator")
