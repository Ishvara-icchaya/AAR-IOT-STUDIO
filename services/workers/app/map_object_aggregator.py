"""Consume data_object / result_object events → Redis map state, KPI windows, Timescale KPI history."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from kafka import KafkaConsumer

from app._kafka import bootstrap_servers
from app.logging_setup import configure_logging
from app.map_aggregator_db import (
    fetch_data_object_row,
    fetch_device_name,
    fetch_result_object_row,
    fetch_site_name,
    insert_map_kpi_history,
)
from app.map_eligibility import map_eligible_data_object, map_eligible_result_object
from app.pipeline import emit
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)

PREFIX = "aar:map"
SITE_MEMBERS = f"{PREFIX}:site:"
STATE = f"{PREFIX}:state:"
KPI_1H = f"{PREFIX}:kpi:series:1h:"
KPI_24H = f"{PREFIX}:kpi:series:24h:"
AGG = f"{PREFIX}:aggregator:stats"

LATF = "gps.lat"
LONF = "gps.lon"


def _redis():
    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    try:
        import redis

        return redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def _topic_do() -> str:
    return os.environ.get("KAFKA_DATA_OBJECT_CREATED_TOPIC", "data_object.created")


def _topic_ro() -> str:
    return os.environ.get("KAFKA_RESULT_OBJECT_CREATED_TOPIC", "result_object.created")


def _get_path(obj: Any, path: str) -> Any:
    cur: Any = obj
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _coerce_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _extract_lat_lon(payload: dict[str, Any], latf: str, lonf: str) -> tuple[float | None, float | None]:
    lat = _coerce_float(_get_path(payload, latf))
    lon = _coerce_float(_get_path(payload, lonf))
    if lat is None:
        lat = _coerce_float(_get_path(payload, "gps.lat"))
    if lon is None:
        lon = _coerce_float(_get_path(payload, "gps.lon"))
    return lat, lon


def _blink(
    health_status: str | None,
    health_blink: bool | None,
    health_severity: int | None,
    offline: bool | None,
) -> str:
    if offline:
        return "slow"
    s = (health_status or "").strip().lower()
    if s == "red":
        return "fast"
    if s == "yellow":
        return "slow"
    if s == "green":
        return "none"
    if health_blink is True:
        if health_severity is not None and health_severity >= 3:
            return "fast"
        return "slow"
    if health_severity is not None and health_severity >= 3:
        return "fast"
    if health_severity is not None and health_severity >= 1:
        return "slow"
    return "none"


def _extract_health(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "health_status": payload.get("health_status") or payload.get("_health_status"),
        "health_blink": payload.get("health_blink"),
        "health_severity": payload.get("health_severity"),
        "offline": payload.get("offline") or payload.get("device_offline"),
    }


def _numeric_kpi_keys(merged: dict[str, Any], limit: int = 32) -> dict[str, float]:
    out: dict[str, float] = {}
    mets = merged.get("metrics")
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
    df = merged.get("displayFields")
    if isinstance(df, dict):
        for k, v in df.items():
            f = _coerce_float(v)
            if f is not None:
                out[f"df:{k}"] = f
    if len(out) >= limit:
        return dict(list(out.items())[:limit])
    return out


def _trim_series(series: list[dict[str, Any]], *, window_sec: int) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=window_sec)
    out: list[dict[str, Any]] = []
    for p in series:
        try:
            ts = datetime.fromisoformat(str(p.get("t")).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if ts >= cutoff:
            out.append(p)
    return out[-500:]


def _rollup_window(points: list[dict[str, Any]]) -> dict[str, Any]:
    if not points:
        return {"min": None, "max": None, "last": None, "avg": None, "n": 0}
    vals = [_coerce_float(p.get("v")) for p in points]
    vals = [v for v in vals if v is not None]
    if not vals:
        return {"min": None, "max": None, "last": None, "avg": None, "n": 0}
    return {
        "min": min(vals),
        "max": max(vals),
        "last": vals[-1],
        "avg": sum(vals) / len(vals),
        "n": len(vals),
    }


def _trend_summary(metric_key: str, pts: list[dict[str, Any]]) -> dict[str, Any]:
    if len(pts) < 2:
        return {"direction": "flat", "metric_key": metric_key, "summary": "insufficient samples"}
    mid = len(pts) // 2
    a = pts[:mid]
    b = pts[mid:]
    av_a = _rollup_window(a).get("avg")
    av_b = _rollup_window(b).get("avg")
    if av_a is None or av_b is None:
        return {"direction": "flat", "metric_key": metric_key, "summary": "insufficient numeric data"}
    delta = float(av_b) - float(av_a)
    if abs(delta) < 1e-9:
        direction = "flat"
        summary = "stable vs prior window"
    elif delta > 0:
        direction = "up"
        summary = f"rising (~{delta:.4g} vs prior half)"
    else:
        direction = "down"
        summary = f"falling (~{abs(delta):.4g} vs prior half)"
    return {"direction": direction, "metric_key": metric_key, "summary": summary}


def _remove_from_map(r: Any, customer_id: str, site_id: str, source_type: str, source_id: str) -> None:
    tok = f"{source_type}:{source_id}"
    pipe = r.pipeline()
    pipe.srem(f"{SITE_MEMBERS}{site_id}", tok)
    pipe.delete(f"{STATE}{customer_id}:{source_type}:{source_id}")
    pipe.delete(f"{KPI_1H}{customer_id}:{source_type}:{source_id}")
    pipe.delete(f"{KPI_24H}{customer_id}:{source_type}:{source_id}")
    pipe.execute()


def _process_data_object(r: Any, data: dict[str, Any]) -> None:
    oid = str(data.get("data_object_id") or "")
    if not oid:
        return
    row = fetch_data_object_row(oid)
    if not row:
        return
    payload = dict(row["payload"])
    payload["_kpi"] = dict(row["kpi_json"])
    if row.get("health_status"):
        payload["health_status"] = row["health_status"]
    kpi_json = dict(row["kpi_json"])
    if not map_eligible_data_object(
        lifecycle_status=row.get("lifecycle_status"),
        payload=payload,
        kpi_json=kpi_json,
        has_gps=bool(row.get("has_gps")),
        has_kpi=bool(row.get("has_kpi")),
        has_health=bool(row.get("has_health")),
        lat_field=LATF,
        lon_field=LONF,
    ):
        _remove_from_map(r, row["customer_id"], row["site_id"], "data_object", oid)
        return

    lat, lon = _extract_lat_lon(payload, LATF, LONF)
    if lat is None or lon is None:
        _remove_from_map(r, row["customer_id"], row["site_id"], "data_object", oid)
        return

    merged = {**payload, **(payload.get("_kpi") or {})}
    hf = _extract_health(payload)
    blink = _blink(
        hf.get("health_status") if isinstance(hf.get("health_status"), str) else None,
        hf.get("health_blink") if isinstance(hf.get("health_blink"), bool) else None,
        hf.get("health_severity") if isinstance(hf.get("health_severity"), int) else None,
        hf.get("offline") if isinstance(hf.get("offline"), bool) else None,
    )
    device_name = fetch_device_name(row["device_id"])
    site_name = fetch_site_name(row["site_id"])
    kpis = {k: _get_path(merged, k) for k in list(_numeric_kpi_keys(merged).keys())[:16]}
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace("+00:00", "Z")
    numerics = _numeric_kpi_keys(merged)

    trend = {}
    if numerics:
        mk = sorted(numerics.keys())[0]
        trend = _trend_summary(mk, [{"t": now_iso, "v": numerics[mk]}])

    state = {
        "source_type": "data_object",
        "source_id": oid,
        "device_id": str(row["device_id"]) if row.get("device_id") else None,
        "display_name": row.get("name"),
        "device_name": device_name,
        "site_name": site_name,
        "latitude": lat,
        "longitude": lon,
        "kpis": kpis,
        "health_status": hf.get("health_status") or row.get("health_status"),
        "health_message": row.get("health_message") or payload.get("health_message"),
        "blink_mode": blink,
        "updated_at": now_iso,
        "kpi_latest": numerics,
        "display_fields": merged.get("displayFields") if isinstance(merged.get("displayFields"), dict) else {},
        "trend": trend,
    }

    tok = f"data_object:{oid}"
    pipe = r.pipeline()
    pipe.sadd(f"{SITE_MEMBERS}{row['site_id']}", tok)
    pipe.set(f"{STATE}{row['customer_id']}:data_object:{oid}", json.dumps(state, default=str))
    pipe.expire(f"{STATE}{row['customer_id']}:data_object:{oid}", 30 * 24 * 3600)

    for window_key, sec, _ in (
        (KPI_1H, 3600, "1h"),
        (KPI_24H, 86400, "24h"),
    ):
        rkey = f"{window_key}{row['customer_id']}:data_object:{oid}"
        raw_prev = r.get(rkey)
        prev_obj: dict[str, list] = {}
        if raw_prev:
            try:
                prev_obj = json.loads(raw_prev)
                if not isinstance(prev_obj, dict):
                    prev_obj = {}
            except Exception:
                prev_obj = {}
        for metric_key, val in numerics.items():
            pts = prev_obj.get(metric_key) if isinstance(prev_obj.get(metric_key), list) else []
            pts = _trim_series(pts + [{"t": now_iso, "v": val}], window_sec=sec)
            prev_obj[metric_key] = pts
        pipe.set(rkey, json.dumps(prev_obj, default=str))
        pipe.expire(rkey, 30 * 24 * 3600)

    pipe.hincrby(AGG, "events_data_object", 1)
    pipe.hset(AGG, "last_event_at", now_iso)
    pipe.hset(AGG, "last_data_object_id", oid)
    pipe.execute()

    for metric_key, val in numerics.items():
        insert_map_kpi_history(
            time_iso=now_iso,
            customer_id=row["customer_id"],
            object_kind="data_object",
            object_id=oid,
            kpi_key=metric_key,
            value=val,
            record={"source": "map_aggregator"},
        )


def _process_result_object(r: Any, data: dict[str, Any]) -> None:
    oid = str(data.get("result_object_id") or "")
    if not oid:
        return
    row = fetch_result_object_row(oid)
    if not row:
        return
    payload = dict(row["payload_json"])
    if row.get("health_status"):
        payload["health_status"] = row["health_status"]
    if not map_eligible_result_object(payload=payload, lat_field=LATF, lon_field=LONF):
        _remove_from_map(r, row["customer_id"], row["site_id"], "result_object", oid)
        return
    lat, lon = _extract_lat_lon(payload, LATF, LONF)
    if lat is None or lon is None:
        _remove_from_map(r, row["customer_id"], row["site_id"], "result_object", oid)
        return

    merged = dict(payload)
    hf = _extract_health(payload)
    blink = _blink(
        hf.get("health_status") if isinstance(hf.get("health_status"), str) else None,
        hf.get("health_blink") if isinstance(hf.get("health_blink"), bool) else None,
        hf.get("health_severity") if isinstance(hf.get("health_severity"), int) else None,
        hf.get("offline") if isinstance(hf.get("offline"), bool) else None,
    )
    site_name = fetch_site_name(row["site_id"])
    numerics = _numeric_kpi_keys(merged)
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat().replace("+00:00", "Z")
    ls = row.get("latest_seen_at")
    cr = row.get("created_at")
    if ls is not None and hasattr(ls, "isoformat"):
        ro_ts = ls.isoformat().replace("+00:00", "Z")
    elif cr is not None and hasattr(cr, "isoformat"):
        ro_ts = cr.isoformat().replace("+00:00", "Z")
    else:
        ro_ts = now_iso
    kpis = {k: _get_path(merged, k) for k in list(numerics.keys())[:16]}
    trend = {}
    if numerics:
        mk = sorted(numerics.keys())[0]
        trend = _trend_summary(mk, [{"t": now_iso, "v": numerics[mk]}])

    dev_from_payload = None
    if isinstance(payload, dict):
        raw_d = payload.get("device_id") or payload.get("deviceId")
        if raw_d:
            dev_from_payload = str(raw_d).strip() or None
    state = {
        "source_type": "result_object",
        "source_id": oid,
        "device_id": dev_from_payload,
        "display_name": row.get("result_object_name"),
        "device_name": None,
        "site_name": site_name,
        "latitude": lat,
        "longitude": lon,
        "kpis": kpis,
        "health_status": hf.get("health_status") or row.get("health_status"),
        "health_message": payload.get("health_message"),
        "blink_mode": blink,
        "updated_at": ro_ts,
        "kpi_latest": numerics,
        "display_fields": merged.get("displayFields") if isinstance(merged.get("displayFields"), dict) else {},
        "trend": trend,
    }

    tok = f"result_object:{oid}"
    pipe = r.pipeline()
    pipe.sadd(f"{SITE_MEMBERS}{row['site_id']}", tok)
    pipe.set(f"{STATE}{row['customer_id']}:result_object:{oid}", json.dumps(state, default=str))
    pipe.expire(f"{STATE}{row['customer_id']}:result_object:{oid}", 30 * 24 * 3600)

    for window_key, sec, _ in (
        (KPI_1H, 3600, "1h"),
        (KPI_24H, 86400, "24h"),
    ):
        rkey = f"{window_key}{row['customer_id']}:result_object:{oid}"
        raw_prev = r.get(rkey)
        prev_obj: dict[str, list] = {}
        if raw_prev:
            try:
                prev_obj = json.loads(raw_prev)
                if not isinstance(prev_obj, dict):
                    prev_obj = {}
            except Exception:
                prev_obj = {}
        for metric_key, val in numerics.items():
            pts = prev_obj.get(metric_key) if isinstance(prev_obj.get(metric_key), list) else []
            pts = _trim_series(pts + [{"t": now_iso, "v": val}], window_sec=sec)
            prev_obj[metric_key] = pts
        pipe.set(rkey, json.dumps(prev_obj, default=str))
        pipe.expire(rkey, 30 * 24 * 3600)

    pipe.hincrby(AGG, "events_result_object", 1)
    pipe.hset(AGG, "last_event_at", now_iso)
    pipe.hset(AGG, "last_result_object_id", oid)
    pipe.execute()

    for metric_key, val in numerics.items():
        insert_map_kpi_history(
            time_iso=now_iso,
            customer_id=row["customer_id"],
            object_kind="result_object",
            object_id=oid,
            kpi_key=metric_key,
            value=val,
            record={"source": "map_aggregator"},
        )


def _handle(r: Any, data: dict[str, Any]) -> None:
    kind = str(data.get("kind") or "")
    if kind == "data_object_created":
        _process_data_object(r, data)
    elif kind == "result_object_created":
        _process_result_object(r, data)


def main() -> None:
    consumer = KafkaConsumer(
        _topic_do(),
        _topic_ro(),
        bootstrap_servers=bootstrap_servers(),
        group_id="worker-map-aggregator",
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: b,
    )
    emit(
        log,
        component="worker-map-aggregator",
        action="subscriber_started",
        status="ok",
        topics=[_topic_do(), _topic_ro()],
        group_id="worker-map-aggregator",
    )
    start_worker_heartbeat("worker-map-aggregator")
    r = _redis()
    if r is None:
        log.error("worker-map-aggregator: Redis unavailable")
    for msg in consumer:
        if not msg.value or r is None:
            continue
        try:
            data = json.loads(msg.value.decode("utf-8"))
            if isinstance(data, dict):
                _handle(r, data)
        except Exception:
            log.exception("worker-map-aggregator process failed")


if __name__ == "__main__":
    main()
