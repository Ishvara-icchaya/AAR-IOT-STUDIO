"""Trends window API: OpenAPI + bucket normalization."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.trends import TrendBucketPoint
from app.services.trends_window_service import _normalize_bucket, downsample_trend_series


def test_openapi_includes_trends_window() -> None:
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/api/v1/trends/window" in paths


def test_normalize_bucket_accepts_ts_alias_t() -> None:
    pt = _normalize_bucket({"t": "2026-04-30T00:00:00Z", "n": 3, "avg": 2.5, "min": 1, "max": 4, "stddev": 0.5, "is_partial": True})
    assert pt is not None
    assert pt.ts == "2026-04-30T00:00:00Z"
    assert pt.n == 3
    assert pt.avg == 2.5
    assert pt.is_partial is True


def test_normalize_bucket_rejects_missing_timestamp() -> None:
    assert _normalize_bucket({"n": 1}) is None


def test_downsample_trend_series_caps_length() -> None:
    pts = [
        TrendBucketPoint(ts=f"2026-04-30T00:{i:02d}:00Z", avg=float(i), min=0, max=1, stddev=None, n=1, is_partial=False)
        for i in range(10)
    ]
    out = downsample_trend_series(pts, 3)
    assert len(out) == 3
    assert out[0].ts == pts[0].ts
    assert out[-1].ts == pts[-1].ts
