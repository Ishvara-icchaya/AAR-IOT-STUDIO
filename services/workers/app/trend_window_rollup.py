"""Rollup trend:window:* Redis keys from latest_device_state updates (contract MAP_POPUP v1.1).

Writes (per metric):
  trend:window:rdev:{resolved_device_id}:{metric_key}:1h|24h
then mirrors the same JSON to:
  trend:window:endpoint:{endpoint_id}:{metric_key}:1h|24h
(interim: cohort merge for multi-device endpoints is a follow-up; last writer wins per key until then.)

TTL: 1h window → 90m (5400s), 24h window → 26h (93600s).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)

BUCKET_SEC = 300
TTL_WINDOW_1H = 90 * 60
TTL_WINDOW_24H = 26 * 3600
WINDOW_1H_SEC = 3600
WINDOW_24H_SEC = 86400
MAX_BUCKETS_1H = 12
MAX_BUCKETS_24H = 288


def trend_window_rdev_key(resolved_device_id: str, metric_key: str, window: str) -> str:
    return f"trend:window:rdev:{resolved_device_id}:{metric_key}:{window}"


def trend_window_endpoint_key(endpoint_id: str, metric_key: str, window: str) -> str:
    return f"trend:window:endpoint:{endpoint_id}:{metric_key}:{window}"


def _coerce_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def extract_numerics_from_lds_row(row: dict[str, Any], *, limit: int = 24) -> dict[str, float]:
    """Match map_object_aggregator-style numeric extraction from LDS kpi_json + display_json."""
    out: dict[str, float] = {}
    kj = row.get("kpi_json") or {}
    mets = kj.get("metrics")
    if isinstance(mets, dict):
        for k, meta in mets.items():
            if not isinstance(meta, dict):
                continue
            v = meta.get("value")
            if v is None:
                v = meta.get("raw")
            f = _coerce_float(v)
            if f is not None:
                out[str(k)] = f
    df = row.get("display_json") if isinstance(row.get("display_json"), dict) else {}
    if isinstance(df, dict):
        for k, v in df.items():
            f = _coerce_float(v)
            if f is not None:
                out[f"df:{k}"] = f
    if len(out) > limit:
        return dict(list(out.items())[:limit])
    return out


def _floor_bucket_ts_iso(now: datetime) -> str:
    ts = int(now.timestamp())
    floored = ts - (ts % BUCKET_SEC)
    return datetime.fromtimestamp(floored, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_ts(s: str) -> datetime | None:
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _load_series(r: Any, key: str) -> list[dict[str, Any]]:
    raw = r.get(key)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict) and isinstance(data.get("buckets"), list):
            return [x for x in data["buckets"] if isinstance(x, dict)]
    except Exception:
        log.debug("trend window parse failed key=%s", key, exc_info=True)
    return []


def _upsert_bucket(series: list[dict[str, Any]], bucket_ts: str, val: float) -> None:
    for b in series:
        if b.get("ts") == bucket_ts:
            n = int(b.get("n") or 0)
            avg = float(b.get("avg") if b.get("avg") is not None else val)
            new_n = n + 1
            new_avg = (avg * n + val) / new_n if new_n else val
            b["n"] = new_n
            b["avg"] = new_avg
            b["min"] = min(float(b.get("min", val)), val)
            b["max"] = max(float(b.get("max", val)), val)
            b["is_partial"] = True
            b["stddev"] = None if new_n < 2 else b.get("stddev")
            return
    series.append(
        {
            "ts": bucket_ts,
            "avg": val,
            "min": val,
            "max": val,
            "n": 1,
            "stddev": None,
            "is_partial": True,
        }
    )


def _trim_window(
    series: list[dict[str, Any]],
    *,
    now: datetime,
    window_sec: int,
    max_buckets: int,
) -> list[dict[str, Any]]:
    cutoff = now - timedelta(seconds=window_sec)
    kept: list[dict[str, Any]] = []
    for b in sorted(series, key=lambda x: str(x.get("ts", ""))):
        t = _parse_ts(str(b.get("ts", "")))
        if t is None:
            continue
        if t >= cutoff:
            kept.append(b)
    return kept[-max_buckets:]


def apply_trend_windows_for_lds(
    r: Any,
    *,
    resolved_device_id: str,
    endpoint_id: str,
    numerics: dict[str, float],
    now: datetime | None = None,
) -> None:
    """Update rdev then endpoint trend:window keys for 1h and 24h."""
    if not numerics:
        return
    now = now or datetime.now(timezone.utc)
    bucket_ts = _floor_bucket_ts_iso(now)
    pipe = r.pipeline()
    for metric_key, val in numerics.items():
        mk = str(metric_key)
        for window_label, window_sec, max_b, ttl in (
            ("1h", WINDOW_1H_SEC, MAX_BUCKETS_1H, TTL_WINDOW_1H),
            ("24h", WINDOW_24H_SEC, MAX_BUCKETS_24H, TTL_WINDOW_24H),
        ):
            rk = trend_window_rdev_key(resolved_device_id, mk, window_label)
            ser = _load_series(r, rk)
            _upsert_bucket(ser, bucket_ts, float(val))
            ser = _trim_window(ser, now=now, window_sec=window_sec, max_buckets=max_b)
            body = json.dumps(ser, default=str)
            pipe.set(rk, body)
            pipe.expire(rk, ttl)
            ek = trend_window_endpoint_key(endpoint_id, mk, window_label)
            pipe.set(ek, body)
            pipe.expire(ek, ttl)
    try:
        pipe.execute()
    except Exception:
        log.exception("trend window redis pipeline failed")
