"""worker-timeseries-state — in-memory feature flags + basic hourly/daily KPI counters."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from kafka import KafkaConsumer

from app._kafka import bootstrap_servers
from app.logging_setup import configure_logging
from app.pipeline import emit
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def _topic_in() -> str:
    return os.environ.get("KAFKA_DATA_OBJECT_CREATED_TOPIC", "data_object.created")


def _redis():
    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    try:
        import redis

        return redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def _bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.lower() in ("1", "true", "yes")
    return bool(v)


def _ymdh(ts: datetime) -> tuple[str, str]:
    return ts.strftime("%Y%m%d%H"), ts.strftime("%Y%m%d")


def _process_event(data: dict[str, Any]) -> None:
    if data.get("kind") not in (None, "data_object_created"):
        return
    oid = str(data.get("data_object_id") or "")
    site_id = str(data.get("site_id") or "")
    customer_id = str(data.get("customer_id") or "")
    if not oid or not site_id or not customer_id:
        return
    has_gps = _bool(data.get("has_gps"))
    has_kpi = _bool(data.get("has_kpi"))
    has_health = _bool(data.get("has_health"))
    has_timeseries = _bool(data.get("has_timeseries"))
    now = datetime.now(timezone.utc)
    hour_key, day_key = _ymdh(now)

    r = _redis()
    if r is None:
        return
    try:
        base = f"aar:data_object:meta:{oid}"
        pipe = r.pipeline()
        pipe.hset(
            base,
            mapping={
                "customer_id": customer_id,
                "site_id": site_id,
                "has_gps": "1" if has_gps else "0",
                "has_kpi": "1" if has_kpi else "0",
                "has_health": "1" if has_health else "0",
                "has_timeseries": "1" if has_timeseries else "0",
                "updated_at": now.isoformat().replace("+00:00", "Z"),
            },
        )
        pipe.expire(base, 7 * 24 * 3600)

        sf = f"aar:site:features:{site_id}"
        pipe.hincrby(sf, "objects_seen", 1)
        if has_gps:
            pipe.hincrby(sf, "objects_with_gps", 1)
        if has_kpi:
            pipe.hincrby(sf, "objects_with_kpi", 1)
        if has_health:
            pipe.hincrby(sf, "objects_with_health", 1)
        if has_timeseries:
            pipe.hincrby(sf, "objects_with_timeseries", 1)

        if has_timeseries:
            hkey = f"aar:timeseries:hourly:{site_id}:{hour_key}"
            dkey = f"aar:timeseries:daily:{site_id}:{day_key}"
            pipe.hincrby(hkey, "objects_with_timeseries", 1)
            pipe.hincrby(dkey, "objects_with_timeseries", 1)
            pipe.expire(hkey, 14 * 24 * 3600)
            pipe.expire(dkey, 120 * 24 * 3600)
        pipe.execute()
    finally:
        try:
            r.close()
        except Exception:
            pass


def main() -> None:
    log.debug("worker-timeseries-state main() starting")
    consumer = KafkaConsumer(
        _topic_in(),
        bootstrap_servers=bootstrap_servers(),
        group_id="worker-timeseries-state",
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: b,
    )
    emit(
        log,
        component="worker-timeseries-state",
        action="subscriber_started",
        status="ok",
        topic=_topic_in(),
        group_id="worker-timeseries-state",
    )
    start_worker_heartbeat("worker-timeseries-state")
    for msg in consumer:
        if not msg.value:
            continue
        try:
            data = json.loads(msg.value.decode("utf-8"))
            if isinstance(data, dict):
                _process_event(data)
        except Exception:
            log.exception("worker-timeseries-state process failed")


if __name__ == "__main__":
    main()
