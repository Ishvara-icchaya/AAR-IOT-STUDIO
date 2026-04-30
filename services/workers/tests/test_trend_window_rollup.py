"""Unit tests for trend window rollup (no Redis)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from app.trend_window_rollup import (
    _floor_bucket_ts_iso,
    _trim_window,
    _upsert_bucket,
)


class TestTrendWindowRollup(unittest.TestCase):
    def test_floor_bucket_aligns_to_5m(self) -> None:
        now = datetime(2026, 4, 30, 12, 7, 33, tzinfo=timezone.utc)
        ts = _floor_bucket_ts_iso(now)
        self.assertTrue(ts.startswith("2026-04-30T12:05:00"))

    def test_upsert_increments_n(self) -> None:
        ser: list[dict] = []
        _upsert_bucket(ser, "2026-04-30T12:00:00Z", 10.0)
        _upsert_bucket(ser, "2026-04-30T12:00:00Z", 20.0)
        self.assertEqual(len(ser), 1)
        self.assertEqual(ser[0]["n"], 2)
        self.assertAlmostEqual(ser[0]["avg"], 15.0)

    def test_trim_drops_old_buckets(self) -> None:
        now = datetime(2026, 4, 30, 12, 0, 0, tzinfo=timezone.utc)
        ser = [
            {"ts": "2026-04-30T10:00:00Z", "n": 1, "avg": 1.0, "min": 1.0, "max": 1.0},
            {"ts": "2026-04-30T11:55:00Z", "n": 1, "avg": 2.0, "min": 2.0, "max": 2.0},
        ]
        out = _trim_window(ser, now=now, window_sec=3600, max_buckets=12)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["ts"], "2026-04-30T11:55:00Z")


if __name__ == "__main__":
    unittest.main()
