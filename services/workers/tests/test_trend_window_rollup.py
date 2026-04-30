"""Unit tests for trend window rollup (no Redis)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from app.trend_window_rollup import (
    floor_to_5m,
    merge_bucket_stats,
    merge_value_into_bucket,
    new_bucket,
    sort_and_trim_26h,
)


class TestTrendWindowRollup(unittest.TestCase):
    def test_floor_bucket_aligns_to_5m(self) -> None:
        now = datetime(2026, 4, 30, 12, 7, 33, tzinfo=timezone.utc)
        ts = floor_to_5m(now)
        self.assertEqual(ts.minute % 5, 0)
        self.assertEqual(ts.second, 0)

    def test_merge_value_increments_n_and_sums(self) -> None:
        b = new_bucket(floor_to_5m(datetime(2026, 4, 30, 12, 0, tzinfo=timezone.utc)), 10.0)
        merge_value_into_bucket(b, 20.0)
        self.assertEqual(b["n"], 2)
        self.assertAlmostEqual(b["sum"], 30.0)
        self.assertAlmostEqual(b["avg"], 15.0)
        self.assertIsNotNone(b["stddev"])

    def test_merge_bucket_stats_two_devices(self) -> None:
        t0 = floor_to_5m(datetime(2026, 4, 30, 12, 0, tzinfo=timezone.utc))
        a = new_bucket(t0, 10.0)
        b = new_bucket(t0, 30.0)
        m = merge_bucket_stats(None, a, t0)
        m = merge_bucket_stats(m, b, t0)
        self.assertEqual(m["n"], 2)
        self.assertAlmostEqual(m["sum"], 40.0)
        self.assertAlmostEqual(m["min"], 10.0)
        self.assertAlmostEqual(m["max"], 30.0)
        self.assertAlmostEqual(m["avg"], 20.0)

    def test_sort_and_trim_drops_old(self) -> None:
        real_now = datetime.now(timezone.utc)
        old = new_bucket(floor_to_5m(real_now - timedelta(hours=30)), 1.0)
        recent = new_bucket(floor_to_5m(real_now - timedelta(hours=1)), 2.0)
        out = sort_and_trim_26h([old, recent])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["n"], recent["n"])


if __name__ == "__main__":
    unittest.main()
