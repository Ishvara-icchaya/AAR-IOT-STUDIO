"""Map intelligence: freshness rules (server-side contract)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.map_intelligence_service import compute_freshness_status, utc_now


def test_freshness_active_when_recent() -> None:
    now = datetime(2026, 4, 30, 12, 0, 0, tzinfo=timezone.utc)
    last = now - timedelta(seconds=10)
    assert compute_freshness_status(last, 15, now) == "active"


def test_freshness_stale_after_three_x_interval() -> None:
    now = datetime(2026, 4, 30, 12, 0, 0, tzinfo=timezone.utc)
    # 15 * 3 = 45s threshold for stale; age 50s → stale
    last = now - timedelta(seconds=50)
    assert compute_freshness_status(last, 15, now) == "stale"


def test_freshness_offline_after_ten_x_interval() -> None:
    now = datetime(2026, 4, 30, 12, 0, 0, tzinfo=timezone.utc)
    # offline_after = max(60, 150) = 150 for expected 15
    last = now - timedelta(seconds=200)
    assert compute_freshness_status(last, 15, now) == "offline"


def test_freshness_unknown_when_no_last_obs() -> None:
    now = utc_now()
    assert compute_freshness_status(None, 15, now) == "unknown"
