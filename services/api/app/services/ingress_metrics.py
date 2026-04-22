"""Redis-backed ingress observability (canonical path: adapter → raw → MinIO → Kafka).

Workers and the API increment these keys so Monitoring can show throughput and failures.
REST, CoAP, WebSocket, and REST poller use aligned Redis prefixes; see also per-protocol ``last_ingest_at`` and ``quality_events`` zsets.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings

log = logging.getLogger(__name__)

REST_STATS_HASH = "aar:ingress:rest:stats"
REST_FAIL_ZSET = "aar:ingress:rest:fail_events"
REST_OK_PREFIX = "aar:ingress:rest:ok_minute:"
FAIL_ZSET_MAX_AGE_SEC = 900
OK_BUCKET_TTL_SEC = 7200


def _redis():
    try:
        import redis

        return redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    except Exception:
        return None


def record_rest_ingest_ok(*, latency_ms: int) -> None:
    r = _redis()
    if r is None:
        return
    now = time.time()
    minute_key = datetime.fromtimestamp(now, tz=timezone.utc).strftime("%Y%m%d%H%M")
    try:
        pipe = r.pipeline()
        pipe.hincrby(REST_STATS_HASH, "success_total", 1)
        pipe.hset(REST_STATS_HASH, "last_success_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        pipe.hset(REST_STATS_HASH, "last_latency_ms", max(0, int(latency_ms)))
        pipe.incr(REST_OK_PREFIX + minute_key)
        pipe.expire(REST_OK_PREFIX + minute_key, OK_BUCKET_TTL_SEC)
        pipe.execute()
    except Exception:
        log.debug("ingress_metrics record_rest_ingest_ok failed", exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def record_rest_ingest_http_error(*, status_code: int, detail: str) -> None:
    _record_rest_failure(kind=f"http_{status_code}", detail=detail)


def record_rest_ingest_error(*, kind: str, detail: str = "") -> None:
    _record_rest_failure(kind=kind, detail=detail or kind)


def _record_rest_failure(*, kind: str, detail: str) -> None:
    r = _redis()
    if r is None:
        return
    now = time.time()
    try:
        pipe = r.pipeline()
        pipe.hincrby(REST_STATS_HASH, "fail_total", 1)
        pipe.hset(REST_STATS_HASH, "last_fail_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        pipe.hset(REST_STATS_HASH, "last_fail_kind", kind[:128])
        pipe.hset(REST_STATS_HASH, "last_error", (detail or "")[:500])
        pipe.zadd(REST_FAIL_ZSET, {f"{now}:{uuid.uuid4().hex}": now})
        pipe.zremrangebyscore(REST_FAIL_ZSET, 0, now - FAIL_ZSET_MAX_AGE_SEC - 60)
        pipe.execute()
    except Exception:
        log.debug("ingress_metrics record failure failed", exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def _sum_ok_buckets(r, *, minutes: int = 5) -> int:
    total = 0
    now = datetime.now(timezone.utc)
    for i in range(minutes):
        dt = now - timedelta(minutes=i)
        k = REST_OK_PREFIX + dt.strftime("%Y%m%d%H%M")
        try:
            v = r.get(k)
            if v:
                total += int(v)
        except (TypeError, ValueError):
            pass
    return total


def get_rest_ingest_snapshot() -> dict[str, object | None]:
    """Fields for monitoring overview / service rows (best-effort if Redis down)."""
    r = _redis()
    if r is None:
        return {
            "redis_available": False,
            "success_total": None,
            "fail_total": None,
            "last_success_at": None,
            "last_fail_at": None,
            "last_latency_ms": None,
            "last_error": None,
            "failures_last_15m": None,
            "ok_last_5m": None,
        }
    try:
        h = r.hgetall(REST_STATS_HASH) or {}
        now = time.time()
        fail_n = r.zcount(REST_FAIL_ZSET, now - FAIL_ZSET_MAX_AGE_SEC, now + 1)
        ok_5m = _sum_ok_buckets(r, minutes=5)
        return {
            "redis_available": True,
            "success_total": int(h.get("success_total") or 0),
            "fail_total": int(h.get("fail_total") or 0),
            "last_success_at": h.get("last_success_at"),
            "last_fail_at": h.get("last_fail_at"),
            "last_latency_ms": int(h["last_latency_ms"]) if h.get("last_latency_ms") else None,
            "last_error": h.get("last_error"),
            "last_fail_kind": h.get("last_fail_kind"),
            "failures_last_15m": int(fail_n) if fail_n is not None else 0,
            "ok_last_5m": ok_5m,
        }
    except Exception:
        log.debug("ingress_metrics snapshot failed", exc_info=True)
        return {
            "redis_available": False,
            "success_total": None,
            "fail_total": None,
            "last_success_at": None,
            "last_fail_at": None,
            "last_latency_ms": None,
            "last_error": None,
            "failures_last_15m": None,
            "ok_last_5m": None,
        }
    finally:
        try:
            r.close()
        except Exception:
            pass


MQTT_BRIDGE_OPERATIONAL_KEY = "aar:ingress:mqtt_bridge:snapshot"


def mqtt_bridge_operational_snapshot() -> dict[str, Any]:
    """Subscription state from worker-mqtt-bridge (after each DB/env merge resync)."""
    r = _redis()
    out: dict[str, Any] = {
        "snapshot_available": False,
        "last_resync_at": None,
        "subscribed_topics": [],
        "mqtt_bridge_connections": [],
        "resync_interval_seconds": None,
    }
    if r is None:
        return out
    try:
        raw = r.get(MQTT_BRIDGE_OPERATIONAL_KEY)
        if not raw:
            return out
        data = json.loads(raw)
        out["snapshot_available"] = True
        out["last_resync_at"] = data.get("last_resync_at")
        st = data.get("subscribed_topics")
        out["subscribed_topics"] = [str(x) for x in st] if isinstance(st, list) else []
        ri = data.get("resync_interval_seconds")
        if isinstance(ri, (int, float)):
            out["resync_interval_seconds"] = int(ri)
        conns = data.get("connections")
        out["mqtt_bridge_connections"] = conns if isinstance(conns, list) else []
        return out
    except Exception:
        log.debug("mqtt_bridge operational snapshot unreadable", exc_info=True)
        return out
    finally:
        try:
            r.close()
        except Exception:
            pass


def coap_listener_snapshot() -> dict[str, object | None]:
    """Reads JSON from aar:ingress:coap:snapshot (worker-coap-listener)."""
    r = _redis()
    if r is None:
        return {"deployed": False, "note": "Redis unavailable"}
    try:
        raw = r.get("aar:ingress:coap:snapshot")
        if not raw:
            return {
                "deployed": False,
                "note": "No CoAP snapshot yet (worker not running or Redis key expired)",
            }
        return {"deployed": True, **json.loads(raw)}
    except Exception:
        return {"deployed": False, "note": "CoAP snapshot unreadable"}
    finally:
        try:
            r.close()
        except Exception:
            pass


def websocket_listener_snapshot() -> dict[str, object | None]:
    """Reads JSON from aar:ingress:ws:snapshot (worker-websocket-ingest)."""
    r = _redis()
    if r is None:
        return {"deployed": False, "note": "Redis unavailable"}
    try:
        raw = r.get("aar:ingress:ws:snapshot")
        if not raw:
            return {
                "deployed": False,
                "note": "No WebSocket snapshot yet (worker not running or idle)",
            }
        return {"deployed": True, **json.loads(raw)}
    except Exception:
        return {"deployed": False, "note": "WebSocket snapshot unreadable"}
    finally:
        try:
            r.close()
        except Exception:
            pass


def rest_poller_snapshot() -> dict[str, object | None]:
    """Reads JSON from aar:ingress:rest_poller:snapshot (worker-rest-poller)."""
    r = _redis()
    if r is None:
        return {"deployed": False, "note": "Redis unavailable"}
    try:
        raw = r.get("aar:ingress:rest_poller:snapshot")
        if not raw:
            return {
                "deployed": False,
                "note": "No REST poller snapshot yet (worker not running or no polling endpoints)",
            }
        return {"deployed": True, **json.loads(raw)}
    except Exception:
        return {"deployed": False, "note": "REST poller snapshot unreadable"}
    finally:
        try:
            r.close()
        except Exception:
            pass


_QUALITY_ZSET: dict[str, str] = {
    "coap": "aar:ingress:coap:quality_events",
    "websocket": "aar:ingress:ws:quality_events",
    "rest_poller": "aar:ingress:rest_poller:quality_events",
}


def count_quality_events(adapter: str, *, window_sec: int = 900) -> int | None:
    """Count rolling-window adapter quality signals (malformed payloads, reconnect churn, poll failures)."""
    zkey = _QUALITY_ZSET.get(adapter)
    if zkey is None:
        return None
    r = _redis()
    if r is None:
        return None
    try:
        now = time.time()
        return int(r.zcount(zkey, now - window_sec, now + 1))
    except Exception:
        log.debug("ingress_metrics count_quality_events failed adapter=%s", adapter, exc_info=True)
        return None
    finally:
        try:
            r.close()
        except Exception:
            pass


def hot_stream_inactivity_message(
    adapter_label: str,
    snap: dict[str, object | None],
    *,
    min_prior_messages: int,
    max_silence_sec: float,
) -> str | None:
    """If adapter was active (enough prior successes) but last_payload is stale, return alert text."""
    if max_silence_sec <= 0:
        return None
    if not snap.get("deployed"):
        return None
    try:
        mc = int(snap.get("message_count") or 0)
    except (TypeError, ValueError):
        return None
    if mc < min_prior_messages:
        return None
    raw_ts = snap.get("last_payload_at") or snap.get("last_message_at")
    if not isinstance(raw_ts, str) or not raw_ts.strip():
        return None
    try:
        s = raw_ts.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - dt).total_seconds()
    except ValueError:
        return None
    if age <= max_silence_sec:
        return None
    return (
        f"{adapter_label}: no successful payload for {int(age)}s "
        f"(threshold {int(max_silence_sec)}s; prior messages_total={mc})"
    )


def get_rest_ingestion_bucket_series(*, buckets: int = 24, bucket_minutes: int = 10) -> list[dict[str, Any]]:
    """Aggregate REST ok minute counters into buckets (newest bucket last). Best-effort if Redis down."""
    out: list[dict[str, Any]] = []
    r = _redis()
    if r is None:
        for i in range(buckets):
            out.append({"label": f"-{buckets - i - 1}h", "count": 0, "rate_per_min": 0.0})
        return out
    try:
        now = datetime.now(timezone.utc)
        for b in range(buckets):
            end_off = (buckets - 1 - b) * bucket_minutes
            start_off = end_off + bucket_minutes
            bucket_end = now - timedelta(minutes=end_off)
            bucket_start = now - timedelta(minutes=start_off)
            total = 0
            cur = bucket_start
            while cur < bucket_end:
                mk = REST_OK_PREFIX + cur.strftime("%Y%m%d%H%M")
                try:
                    v = r.get(mk)
                    if v:
                        total += int(v)
                except (TypeError, ValueError):
                    pass
                cur += timedelta(minutes=1)
            label = bucket_start.strftime("%H:%M")
            mins = max(1, int((bucket_end - bucket_start).total_seconds() // 60))
            rate = round(total / float(mins), 2)
            out.append({"label": label, "count": total, "rate_per_min": rate})
        return out
    except Exception:
        log.debug("get_rest_ingestion_bucket_series failed", exc_info=True)
        return [{"label": "", "count": 0, "rate_per_min": 0.0} for _ in range(buckets)]
    finally:
        try:
            r.close()
        except Exception:
            pass
