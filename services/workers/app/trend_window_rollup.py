"""Three-level trend rollup: rdev → endpoint → site (MAP_POPUP contract).

5m series keys (26h TTL):
  trend:rdev:{resolved_device_id}:{metric}:5m
  trend:endpoint:{endpoint_id}:{metric}:5m
  trend:site:{site_id}:{metric}:5m

Window keys (slice from 5m series; TTL 90m / 26h):
  trend:window:{rdev|endpoint|site}:{entity_id}:{metric}:1h|24h

Endpoint/site buckets are true aggregates over cohort members (re-read rdev/endpoint series each event).
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)

BUCKET_SECONDS = 300
TTL_SERIES_5M = 26 * 3600
TTL_WINDOW_1H = 90 * 60
TTL_WINDOW_24H = 26 * 3600


def json_dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


def floor_to_5m(ts: datetime) -> datetime:
    ts = ts.astimezone(timezone.utc)
    epoch = int(ts.timestamp())
    bucket_epoch = epoch - (epoch % BUCKET_SECONDS)
    return datetime.fromtimestamp(bucket_epoch, tz=timezone.utc)


def _parse_ts_iso(s: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(timezone.utc)
    except Exception:
        return None


def load_bucket_array(r: Any, key: str) -> list[dict[str, Any]]:
    raw = r.get(key)
    if not raw:
        return []
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "buckets" in parsed:
            inner = parsed["buckets"]
            return [x for x in inner if isinstance(x, dict)] if isinstance(inner, list) else []
        if isinstance(parsed, list):
            return [x for x in parsed if isinstance(x, dict)]
    except Exception:
        log.debug("trend load_bucket_array parse failed key=%s", key, exc_info=True)
    return []


def find_bucket(buckets: list[dict[str, Any]], bucket_start: datetime) -> dict[str, Any] | None:
    t0 = floor_to_5m(bucket_start)
    for bucket in buckets:
        raw = bucket.get("bucket_start") or bucket.get("ts")
        if not raw:
            continue
        t = _parse_ts_iso(str(raw))
        if t is None:
            continue
        if floor_to_5m(t) == t0:
            return bucket
    return None


def new_bucket(bucket_start: datetime, value: float) -> dict[str, Any]:
    iso = bucket_start.isoformat().replace("+00:00", "Z")
    v = float(value)
    return {
        "ts": iso,
        "bucket_start": iso,
        "bucket_size_sec": BUCKET_SECONDS,
        "n": 1,
        "sum": v,
        "sumsq": v * v,
        "min": v,
        "max": v,
        "avg": v,
        "stddev": None,
        "is_partial": True,
    }


def merge_value_into_bucket(bucket: dict[str, Any], value: float) -> dict[str, Any]:
    v = float(value)
    n = int(bucket.get("n", 0)) + 1
    s = float(bucket.get("sum", 0)) + v
    ssq = float(bucket.get("sumsq", 0)) + v * v
    bucket["n"] = n
    bucket["sum"] = s
    bucket["sumsq"] = ssq
    bucket["min"] = min(float(bucket.get("min", v)), v)
    bucket["max"] = max(float(bucket.get("max", v)), v)
    bucket["avg"] = s / n if n else v
    if n >= 2:
        variance = (ssq / n) - (bucket["avg"] * bucket["avg"])
        bucket["stddev"] = math.sqrt(max(variance, 0.0))
    else:
        bucket["stddev"] = None
    bucket["is_partial"] = True
    return bucket


def merge_bucket_stats(
    target: dict[str, Any] | None,
    source: dict[str, Any] | None,
    bucket_start: datetime,
) -> dict[str, Any] | None:
    if source is None:
        return target
    source_n = int(source.get("n", 0))
    if source_n <= 0:
        return target

    iso = bucket_start.isoformat().replace("+00:00", "Z")
    if target is None:
        target = {
            "ts": iso,
            "bucket_start": iso,
            "bucket_size_sec": BUCKET_SECONDS,
            "n": 0,
            "sum": 0.0,
            "sumsq": 0.0,
            "min": None,
            "max": None,
            "avg": None,
            "stddev": None,
            "is_partial": True,
        }

    target["n"] = int(target.get("n", 0)) + source_n
    target["sum"] = float(target.get("sum", 0)) + float(source.get("sum", 0))
    target["sumsq"] = float(target.get("sumsq", 0)) + float(source.get("sumsq", 0))

    smin = source.get("min")
    smax = source.get("max")
    if smin is not None:
        smin_f = float(smin)
        target["min"] = smin_f if target.get("min") is None else min(float(target["min"]), smin_f)
    if smax is not None:
        smax_f = float(smax)
        target["max"] = smax_f if target.get("max") is None else max(float(target["max"]), smax_f)

    tn = int(target["n"])
    if tn > 0:
        target["avg"] = float(target["sum"]) / tn
        if tn >= 2:
            variance = (float(target["sumsq"]) / tn) - (float(target["avg"]) ** 2)
            target["stddev"] = math.sqrt(max(variance, 0.0))
        else:
            target["stddev"] = None
    target["is_partial"] = bool(source.get("is_partial", True)) or bool(target.get("is_partial", True))
    return target


def upsert_bucket_list(buckets: list[dict[str, Any]], bucket: dict[str, Any], bucket_start: datetime) -> list[dict[str, Any]]:
    t0 = floor_to_5m(bucket_start)
    replaced = False
    for idx, existing in enumerate(buckets):
        raw = existing.get("bucket_start") or existing.get("ts")
        if not raw:
            continue
        t = _parse_ts_iso(str(raw))
        if t is not None and floor_to_5m(t) == t0:
            buckets[idx] = bucket
            replaced = True
            break
    if not replaced:
        buckets.append(bucket)
    return buckets


def sort_and_trim_26h(buckets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=26)

    def bucket_ts(b: dict[str, Any]) -> datetime:
        raw = b.get("bucket_start") or b.get("ts")
        t = _parse_ts_iso(str(raw)) if raw else None
        return t or datetime.min.replace(tzinfo=timezone.utc)

    filtered = [b for b in buckets if bucket_ts(b) >= cutoff]
    return sorted(filtered, key=bucket_ts)


def slice_window(buckets: list[dict[str, Any]], hours: int) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)

    def bucket_ts(b: dict[str, Any]) -> datetime:
        raw = b.get("bucket_start") or b.get("ts")
        t = _parse_ts_iso(str(raw)) if raw else None
        return t or datetime.min.replace(tzinfo=timezone.utc)

    return sorted([b for b in buckets if bucket_ts(b) >= cutoff], key=bucket_ts)


def write_window_keys(r: Any, scope: str, entity_id: str, metric_key: str, buckets: list[dict[str, Any]]) -> None:
    one_hour = slice_window(buckets, 1)
    twenty_four = slice_window(buckets, 24)
    k1 = f"trend:window:{scope}:{entity_id}:{metric_key}:1h"
    k24 = f"trend:window:{scope}:{entity_id}:{metric_key}:24h"
    try:
        r.set(k1, json_dumps(one_hour))
        r.expire(k1, TTL_WINDOW_1H)
        r.set(k24, json_dumps(twenty_four))
        r.expire(k24, TTL_WINDOW_24H)
    except Exception:
        log.exception("write_window_keys failed scope=%s entity=%s metric=%s", scope, entity_id, metric_key)


def _series_key_rdev(rdev_id: str, metric_key: str) -> str:
    return f"trend:rdev:{rdev_id}:{metric_key}:5m"


def _series_key_endpoint(endpoint_id: str, metric_key: str) -> str:
    return f"trend:endpoint:{endpoint_id}:{metric_key}:5m"


def _series_key_site(site_id: str, metric_key: str) -> str:
    return f"trend:site:{site_id}:{metric_key}:5m"


def update_rdev_bucket(
    r: Any,
    *,
    resolved_device_id: str,
    metric_key: str,
    value: float,
    bucket_start: datetime,
) -> dict[str, Any] | None:
    key = _series_key_rdev(resolved_device_id, metric_key)
    buckets = load_bucket_array(r, key)
    b = find_bucket(buckets, bucket_start)
    if b is None:
        b = new_bucket(bucket_start, value)
        buckets.append(b)
    else:
        merge_value_into_bucket(b, value)
    buckets = sort_and_trim_26h(buckets)
    try:
        r.set(key, json_dumps(buckets))
        r.expire(key, TTL_SERIES_5M)
    except Exception:
        log.exception("update_rdev_bucket redis set failed key=%s", key)
        return None
    write_window_keys(r, "rdev", resolved_device_id, metric_key, buckets)
    return b


def rebuild_endpoint_bucket(
    r: Any,
    *,
    endpoint_id: str,
    metric_key: str,
    bucket_start: datetime,
    resolved_device_ids: list[str],
) -> dict[str, Any] | None:
    endpoint_bucket: dict[str, Any] | None = None
    for rdev_id in resolved_device_ids:
        rdev_key = _series_key_rdev(rdev_id, metric_key)
        rdev_buckets = load_bucket_array(r, rdev_key)
        rdev_b = find_bucket(rdev_buckets, bucket_start)
        if not rdev_b:
            continue
        endpoint_bucket = merge_bucket_stats(endpoint_bucket, rdev_b, bucket_start)

    if endpoint_bucket is None:
        return None

    ep_key = _series_key_endpoint(endpoint_id, metric_key)
    ep_buckets = load_bucket_array(r, ep_key)
    ep_buckets = upsert_bucket_list(ep_buckets, endpoint_bucket, bucket_start)
    ep_buckets = sort_and_trim_26h(ep_buckets)
    try:
        r.set(ep_key, json_dumps(ep_buckets))
        r.expire(ep_key, TTL_SERIES_5M)
    except Exception:
        log.exception("rebuild_endpoint_bucket set failed key=%s", ep_key)
        return None
    write_window_keys(r, "endpoint", endpoint_id, metric_key, ep_buckets)
    return endpoint_bucket


def rebuild_site_bucket(
    r: Any,
    *,
    site_id: str,
    metric_key: str,
    bucket_start: datetime,
    endpoint_ids: list[str],
) -> dict[str, Any] | None:
    site_bucket: dict[str, Any] | None = None
    for eid in endpoint_ids:
        ep_key = _series_key_endpoint(eid, metric_key)
        ep_buckets = load_bucket_array(r, ep_key)
        ep_b = find_bucket(ep_buckets, bucket_start)
        if not ep_b:
            continue
        site_bucket = merge_bucket_stats(site_bucket, ep_b, bucket_start)

    if site_bucket is None:
        return None

    sk = _series_key_site(site_id, metric_key)
    site_buckets = load_bucket_array(r, sk)
    site_buckets = upsert_bucket_list(site_buckets, site_bucket, bucket_start)
    site_buckets = sort_and_trim_26h(site_buckets)
    try:
        r.set(sk, json_dumps(site_buckets))
        r.expire(sk, TTL_SERIES_5M)
    except Exception:
        log.exception("rebuild_site_bucket set failed key=%s", sk)
        return None
    write_window_keys(r, "site", site_id, metric_key, site_buckets)
    return site_bucket


def _coerce_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def extract_numerics_from_lds_row(row: dict[str, Any], *, limit: int = 24) -> dict[str, float]:
    """Numeric metrics from LDS kpi_json + display_json."""
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


def _event_ts_from_row(row: dict[str, Any]) -> datetime:
    le = row.get("last_event_ts")
    ua = row.get("updated_at")
    for candidate in (le, ua):
        if isinstance(candidate, datetime):
            if candidate.tzinfo is None:
                return candidate.replace(tzinfo=timezone.utc)
            return candidate.astimezone(timezone.utc)
        if isinstance(candidate, str) and candidate.strip():
            t = _parse_ts_iso(candidate.strip())
            if t:
                return t
    return datetime.now(timezone.utc)


def apply_trend_rollups_from_lds_row(
    r: Any,
    *,
    row: dict[str, Any],
    numerics: dict[str, float],
) -> None:
    """Full hierarchy: rdev 5m + windows → endpoint aggregate → site aggregate."""
    if not numerics:
        return
    site_id = str(row["site_id"])
    endpoint_id = str(row["endpoint_id"])
    rdev_id = str(row["resolved_device_id"])
    event_ts = _event_ts_from_row(row)
    bucket_start = floor_to_5m(event_ts)

    try:
        from app.map_aggregator_db import fetch_endpoint_ids_for_site, fetch_resolved_device_ids_for_endpoint

        rdev_ids = fetch_resolved_device_ids_for_endpoint(endpoint_id)
        endpoint_ids = fetch_endpoint_ids_for_site(site_id)
    except Exception:
        log.exception("trend rollup DB list fetch failed")
        rdev_ids = [rdev_id]
        endpoint_ids = [endpoint_id]

    if rdev_id not in rdev_ids:
        rdev_ids = list(dict.fromkeys([*rdev_ids, rdev_id]))
    if endpoint_id not in endpoint_ids:
        endpoint_ids = list(dict.fromkeys([*endpoint_ids, endpoint_id]))

    customer_id = str(row["customer_id"])
    try:
        from app.map_aggregator_db import upsert_trend_metric_bucket as _upsert_trend_metric_bucket
    except Exception:
        _upsert_trend_metric_bucket = None  # type: ignore[assignment,misc]

    for metric_key, raw_val in numerics.items():
        mk = str(metric_key)
        val = float(raw_val)
        try:
            r_b = update_rdev_bucket(
                r,
                resolved_device_id=rdev_id,
                metric_key=mk,
                value=val,
                bucket_start=bucket_start,
            )
            ep_b = rebuild_endpoint_bucket(
                r,
                endpoint_id=endpoint_id,
                metric_key=mk,
                bucket_start=bucket_start,
                resolved_device_ids=rdev_ids,
            )
            site_b = rebuild_site_bucket(
                r,
                site_id=site_id,
                metric_key=mk,
                bucket_start=bucket_start,
                endpoint_ids=endpoint_ids,
            )
        except Exception:
            log.exception("trend rollup failed metric=%s rdev=%s", mk, rdev_id)
            continue

        if _upsert_trend_metric_bucket is not None:
            try:
                if r_b:
                    _upsert_trend_metric_bucket(
                        bucket_time=bucket_start,
                        customer_id=customer_id,
                        site_id=site_id,
                        scope="rdev",
                        entity_id=rdev_id,
                        metric_key=mk,
                        bucket=r_b,
                    )
                if ep_b:
                    _upsert_trend_metric_bucket(
                        bucket_time=bucket_start,
                        customer_id=customer_id,
                        site_id=site_id,
                        scope="endpoint",
                        entity_id=endpoint_id,
                        metric_key=mk,
                        bucket=ep_b,
                    )
                if site_b:
                    _upsert_trend_metric_bucket(
                        bucket_time=bucket_start,
                        customer_id=customer_id,
                        site_id=site_id,
                        scope="site",
                        entity_id=site_id,
                        metric_key=mk,
                        bucket=site_b,
                    )
            except Exception:
                log.exception("trend_metric_bucket Timescale persist failed metric=%s rdev=%s", mk, rdev_id)


# Back-compat names for tests / imports
def trend_window_rdev_key(resolved_device_id: str, metric_key: str, window: str) -> str:
    return f"trend:window:rdev:{resolved_device_id}:{metric_key}:{window}"


def trend_window_endpoint_key(endpoint_id: str, metric_key: str, window: str) -> str:
    return f"trend:window:endpoint:{endpoint_id}:{metric_key}:{window}"
