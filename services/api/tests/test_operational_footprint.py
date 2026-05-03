"""Golden checks for operational lineage status + recommendations."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.core.operational_footprint import (
    OperationalFootprintContext,
    derive_recommendation,
    evaluate_status,
)

UTC = timezone.utc


def _ctx(
    *,
    created_offset_min: float = 20.0,
    last_ingest_offset_min: float | None = None,
    endpoint_id: str | None = "ep-1",
    activation_status: str | None = "active",
    resolved_device_id: str | None = "rd-1",
    expected_frequency_sec: int = 60,
    pipeline_error: bool = False,
    scrubber_configured: bool = True,
    dashboard_association_count: int = 1,
    now: datetime | None = None,
) -> tuple[OperationalFootprintContext, datetime]:
    n = now or datetime(2026, 4, 30, 12, 0, 0, tzinfo=UTC)
    created = n - timedelta(minutes=created_offset_min)
    last_at = None
    if last_ingest_offset_min is not None:
        last_at = n - timedelta(minutes=last_ingest_offset_min)
    ctx = OperationalFootprintContext(
        device_id="dev-1",
        created_at=created,
        endpoint_id=endpoint_id,
        activation_status=activation_status,
        resolved_device_id=resolved_device_id,
        last_ingested_at=last_at,
        expected_frequency_sec=expected_frequency_sec,
        pipeline_error=pipeline_error,
        scrubber_configured=scrubber_configured,
        dashboard_association_count=dashboard_association_count,
    )
    return ctx, n


def test_unknown_bootstrap_window() -> None:
    ctx, n = _ctx(created_offset_min=5, last_ingest_offset_min=None, endpoint_id=None)
    assert evaluate_status(ctx, now=n) == "unknown"
    code, msg = derive_recommendation(ctx, "unknown", now=n)
    assert code == "NO_INITIAL_INGEST"
    assert "bootstrap" in msg.lower()


def test_incomplete_no_endpoint_after_bootstrap() -> None:
    ctx, n = _ctx(created_offset_min=20, endpoint_id=None, last_ingest_offset_min=None)
    assert evaluate_status(ctx, now=n) == "incomplete"
    code, _msg = derive_recommendation(ctx, "incomplete", now=n)
    assert code == "NO_ENDPOINT"


def test_incomplete_not_activated() -> None:
    ctx, n = _ctx(
        created_offset_min=20,
        endpoint_id="ep",
        activation_status="configured",
        last_ingest_offset_min=None,
    )
    assert evaluate_status(ctx, now=n) == "incomplete"
    assert derive_recommendation(ctx, "incomplete", now=n)[0] == "NOT_ACTIVATED"


def test_incomplete_no_initial_ingest_priority_over_no_resolved() -> None:
    """Active + past bootstrap + no ingest: NO_INITIAL_INGEST before NO_RESOLVED_DEVICE."""
    ctx, n = _ctx(
        created_offset_min=20,
        activation_status="active",
        resolved_device_id=None,
        last_ingest_offset_min=None,
    )
    assert evaluate_status(ctx, now=n) == "incomplete"
    assert derive_recommendation(ctx, "incomplete", now=n)[0] == "NO_INITIAL_INGEST"


def test_incomplete_no_resolved_when_ingesting() -> None:
    ctx, n = _ctx(
        created_offset_min=20,
        activation_status="active",
        resolved_device_id=None,
        last_ingest_offset_min=1,
    )
    assert evaluate_status(ctx, now=n) == "incomplete"
    assert derive_recommendation(ctx, "incomplete", now=n)[0] == "NO_RESOLVED_DEVICE"


def test_incomplete_scrubber_not_configured() -> None:
    ctx, n = _ctx(
        created_offset_min=20,
        activation_status="active",
        resolved_device_id="rd",
        last_ingest_offset_min=1,
        scrubber_configured=False,
    )
    assert evaluate_status(ctx, now=n) == "incomplete"
    assert derive_recommendation(ctx, "incomplete", now=n)[0] == "SCRUBBER_NOT_CONFIGURED"


@pytest.mark.parametrize(
    ("age_min", "freq", "expect_stale"),
    [
        (2, 60, False),
        (4, 60, True),
    ],
)
def test_stale_threshold_three_times_frequency(age_min: float, freq: int, expect_stale: bool) -> None:
    n = datetime(2026, 4, 30, 12, 0, 0, tzinfo=UTC)
    ctx, _ = _ctx(
        created_offset_min=120,
        last_ingest_offset_min=age_min,
        expected_frequency_sec=freq,
        now=n,
    )
    st = evaluate_status(ctx, now=n)
    if expect_stale:
        assert st == "stale"
        assert derive_recommendation(ctx, st, now=n)[0] == "NO_RECENT_INGEST"
    else:
        assert st == "ready"


def test_broken_over_stale() -> None:
    n = datetime(2026, 4, 30, 12, 0, 0, tzinfo=UTC)
    ctx, _ = _ctx(
        created_offset_min=120,
        last_ingest_offset_min=500,
        pipeline_error=True,
        now=n,
    )
    assert evaluate_status(ctx, now=n) == "broken"
    assert derive_recommendation(ctx, "broken", now=n)[0] == "PIPELINE_ERROR"


def test_ready_no_dashboard_association() -> None:
    ctx, n = _ctx(
        created_offset_min=120,
        last_ingest_offset_min=1,
        dashboard_association_count=0,
        now=datetime(2026, 4, 30, 12, 0, 0, tzinfo=UTC),
    )
    st = evaluate_status(ctx, now=n)
    assert st == "ready"
    code, _msg = derive_recommendation(ctx, st, now=n)
    assert code == "NO_DASHBOARD_ASSOCIATION"


def test_ready_healthy_with_dashboard() -> None:
    ctx, n = _ctx(
        created_offset_min=120,
        last_ingest_offset_min=1,
        dashboard_association_count=2,
        now=datetime(2026, 4, 30, 12, 0, 0, tzinfo=UTC),
    )
    st = evaluate_status(ctx, now=n)
    assert st == "ready"
    assert derive_recommendation(ctx, st, now=n)[0] == "HEALTHY"
