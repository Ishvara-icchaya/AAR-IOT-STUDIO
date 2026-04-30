"""Rebuild Redis trend 5m series + window keys from Timescale ``trend_metric_bucket``.

Operational recovery when Redis loses trend data but Timescale still has rows.
Uses the same key layout and JSON bucket shape as ``trend_window_rollup`` (workers).
"""

from __future__ import annotations

import json
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings
from app.services.trend_redis_contract import (
    trend_series_endpoint_key,
    trend_series_rdev_key,
    trend_series_site_key,
    trend_window_endpoint_key,
    trend_window_rdev_key,
    trend_window_site_key,
)

log = logging.getLogger(__name__)

TTL_SERIES_5M = 26 * 3600
TTL_WINDOW_1H = 90 * 60
TTL_WINDOW_24H = 26 * 3600


def json_dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


def _parse_ts_iso(s: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(timezone.utc)
    except Exception:
        return None


def _bucket_ts(b: dict[str, Any]) -> datetime:
    raw = b.get("bucket_start") or b.get("ts")
    if not raw:
        return datetime.min.replace(tzinfo=timezone.utc)
    t = _parse_ts_iso(str(raw))
    return t or datetime.min.replace(tzinfo=timezone.utc)


def slice_window_buckets(buckets: list[dict[str, Any]], hours: int) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    return sorted([b for b in buckets if _bucket_ts(b) >= cutoff], key=_bucket_ts)


def write_window_keys(r: Any, scope: str, entity_id: str, metric_key: str, buckets: list[dict[str, Any]]) -> None:
    one_hour = slice_window_buckets(buckets, 1)
    twenty_four = slice_window_buckets(buckets, 24)
    if scope == "rdev":
        k1 = trend_window_rdev_key(entity_id, metric_key, "1h")
        k24 = trend_window_rdev_key(entity_id, metric_key, "24h")
    elif scope == "endpoint":
        k1 = trend_window_endpoint_key(entity_id, metric_key, "1h")
        k24 = trend_window_endpoint_key(entity_id, metric_key, "24h")
    elif scope == "site":
        k1 = trend_window_site_key(entity_id, metric_key, "1h")
        k24 = trend_window_site_key(entity_id, metric_key, "24h")
    else:
        raise ValueError(f"unsupported scope {scope!r}")
    try:
        r.set(k1, json_dumps(one_hour))
        r.expire(k1, TTL_WINDOW_1H)
        r.set(k24, json_dumps(twenty_four))
        r.expire(k24, TTL_WINDOW_24H)
    except Exception:
        log.exception("write_window_keys failed scope=%s entity=%s metric=%s", scope, entity_id, metric_key)


def _series_key(scope: str, entity_id: str, metric_key: str) -> str:
    if scope == "rdev":
        return trend_series_rdev_key(entity_id, metric_key)
    if scope == "endpoint":
        return trend_series_endpoint_key(entity_id, metric_key)
    if scope == "site":
        return trend_series_site_key(entity_id, metric_key)
    raise ValueError(f"unsupported scope {scope!r}")


def _row_to_bucket(row: dict[str, Any]) -> dict[str, Any]:
    bt: datetime = row["bucket_time"]
    if isinstance(bt, datetime):
        if bt.tzinfo is None:
            bt = bt.replace(tzinfo=timezone.utc)
        bt = bt.astimezone(timezone.utc)
    else:
        bt = datetime.now(timezone.utc)
    iso = bt.isoformat().replace("+00:00", "Z")
    n = int(row.get("n") or 0)
    sum_v = float(row.get("sum") or 0)
    sumsq_v = float(row.get("sumsq") or 0)
    min_v = row.get("min")
    max_v = row.get("max")
    avg_v = row.get("avg")
    std_v = None if n < 2 else row.get("stddev")
    partial = bool(row.get("is_partial", True))
    return {
        "ts": iso,
        "bucket_start": iso,
        "bucket_size_sec": 300,
        "n": n,
        "sum": sum_v,
        "sumsq": sumsq_v,
        "min": None if min_v is None else float(min_v),
        "max": None if max_v is None else float(max_v),
        "avg": None if avg_v is None else float(avg_v),
        "stddev": None if std_v is None else float(std_v),
        "is_partial": partial,
    }


def rebuild_redis_trends_from_timescale(
    *,
    site_id: uuid.UUID,
    hours: int = 26,
) -> int:
    """Load ``trend_metric_bucket`` rows for ``site_id`` in the last ``hours`` and rewrite Redis series + windows.

    Returns number of distinct (scope, entity_id, metric_key) series keys written.
    """
    import psycopg2
    import redis

    hours = max(1, min(int(hours), 168))
    t1 = datetime.now(timezone.utc)
    t0 = t1 - timedelta(hours=hours)
    url = settings.timescale_database_url.replace("postgresql+psycopg2://", "postgresql://")
    r = redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=5, socket_timeout=30)
    keys_written = 0
    try:
        conn = psycopg2.connect(url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT bucket_time, scope, entity_id::text, metric_key, n, sum, sumsq, min, max, avg, stddev, is_partial
                    FROM trend_metric_bucket
                    WHERE site_id = %s::uuid
                      AND bucket_time >= %s AND bucket_time < %s
                    ORDER BY bucket_time ASC
                    """,
                    (str(site_id), t0, t1),
                )
                cols = [d[0] for d in cur.description] if cur.description else []
                groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
                for row in cur.fetchall():
                    rec = dict(zip(cols, row))
                    scope = str(rec.get("scope") or "")
                    eid = str(rec.get("entity_id") or "")
                    mk = str(rec.get("metric_key") or "")
                    if scope not in ("rdev", "endpoint", "site") or not eid or not mk:
                        continue
                    groups[(scope, eid, mk)].append(_row_to_bucket(rec))
        finally:
            conn.close()

        for (scope, eid, mk), buckets in groups.items():
            buckets = sorted(buckets, key=_bucket_ts)
            cutoff = datetime.now(timezone.utc) - timedelta(hours=26)
            buckets = [b for b in buckets if _bucket_ts(b) >= cutoff]
            if not buckets:
                continue
            sk = _series_key(scope, eid, mk)
            r.set(sk, json_dumps(buckets))
            r.expire(sk, TTL_SERIES_5M)
            write_window_keys(r, scope, eid, mk, buckets)
            keys_written += 1
    finally:
        try:
            r.close()
        except Exception:
            pass
    return keys_written
