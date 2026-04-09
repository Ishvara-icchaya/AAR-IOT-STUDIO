"""Per-adapter Redis stats + JSON snapshot for monitoring (CoAP / WebSocket / REST poller)."""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger(__name__)

OK_BUCKET_TTL_SEC = 7200
QUALITY_EVENTS_MAX_AGE_SEC = 900

ADAPTER_PREFIX: dict[str, str] = {
    "coap": "aar:ingress:coap",
    "websocket": "aar:ingress:ws",
    "rest_poller": "aar:ingress:rest_poller",
}


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _redis():
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        import redis

        return redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    except Exception:
        return None


def _sum_ok_minutes(r: Any, prefix: str, minutes: int = 5) -> int:
    total = 0
    now = datetime.now(timezone.utc)
    for i in range(minutes):
        dt = now - timedelta(minutes=i)
        k = f"{prefix}:ok_minute:{dt.strftime('%Y%m%d%H%M')}"
        try:
            v = r.get(k)
            if v:
                total += int(v)
        except (TypeError, ValueError):
            pass
    return total


def _stats_key(prefix: str) -> str:
    return f"{prefix}:stats"


def _flush_snapshot(r: Any, prefix: str) -> None:
    h = r.hgetall(_stats_key(prefix)) or {}
    try:
        mc = int(h.get("message_count") or 0)
    except (TypeError, ValueError):
        mc = 0
    try:
        ec = int(h.get("error_count") or 0)
    except (TypeError, ValueError):
        ec = 0
    try:
        poll_total = int(h.get("poll_total") or 0)
    except (TypeError, ValueError):
        poll_total = 0
    try:
        poll_fail_total = int(h.get("poll_fail_total") or 0)
    except (TypeError, ValueError):
        poll_fail_total = 0

    snap: dict[str, Any] = {
        "deployed": True,
        "status": h.get("status") or "running",
        "message_count": mc,
        "error_count": ec,
        "last_message_at": h.get("last_message_at"),
        "last_payload_at": h.get("last_payload_at"),
        "last_error": (h.get("last_error") or "")[:500],
        "messages_last_5m": _sum_ok_minutes(r, prefix, 5),
    }
    if poll_total or poll_fail_total:
        snap["poll_total"] = poll_total
        snap["poll_fail_total"] = poll_fail_total
        snap["last_poll_at"] = h.get("last_poll_at")

    r.set(f"{prefix}:snapshot", json.dumps(snap, separators=(",", ":")))


def write_adapter_boot(adapter: str, *, status: str) -> None:
    prefix = ADAPTER_PREFIX.get(adapter)
    if not prefix:
        return
    r = _redis()
    if r is None:
        return
    try:
        sk = _stats_key(prefix)
        if not r.exists(sk):
            r.hset(
                sk,
                mapping={
                    "message_count": 0,
                    "error_count": 0,
                    "status": status,
                },
            )
        else:
            r.hset(sk, "status", status)
        _flush_snapshot(r, prefix)
    except Exception:
        log.debug("ingress_redis_metrics boot failed adapter=%s", adapter, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def record_ingest_success(adapter: str, *, health_status: str | None = None) -> None:
    prefix = ADAPTER_PREFIX.get(adapter)
    if not prefix:
        return
    r = _redis()
    if r is None:
        return
    try:
        now = _iso()
        minute_key = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
        ok_key = f"{prefix}:ok_minute:{minute_key}"
        pipe = r.pipeline()
        pipe.hincrby(_stats_key(prefix), "message_count", 1)
        pipe.hset(_stats_key(prefix), "last_message_at", now)
        pipe.hset(_stats_key(prefix), "last_payload_at", now)
        if health_status:
            pipe.hset(_stats_key(prefix), "status", health_status[:64])
        pipe.incr(ok_key)
        pipe.expire(ok_key, OK_BUCKET_TTL_SEC)
        pipe.execute()
        _flush_snapshot(r, prefix)
    except Exception:
        log.debug("ingress_redis_metrics success failed adapter=%s", adapter, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def record_ingest_error(adapter: str, detail: str) -> None:
    prefix = ADAPTER_PREFIX.get(adapter)
    if not prefix:
        return
    r = _redis()
    if r is None:
        return
    try:
        pipe = r.pipeline()
        pipe.hincrby(_stats_key(prefix), "error_count", 1)
        pipe.hset(_stats_key(prefix), "last_error", (detail or "")[:500])
        pipe.execute()
        _flush_snapshot(r, prefix)
    except Exception:
        log.debug("ingress_redis_metrics error failed adapter=%s", adapter, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def set_adapter_status(adapter: str, status: str) -> None:
    prefix = ADAPTER_PREFIX.get(adapter)
    if not prefix:
        return
    r = _redis()
    if r is None:
        return
    try:
        r.hset(_stats_key(prefix), "status", status[:64])
        _flush_snapshot(r, prefix)
    except Exception:
        log.debug("ingress_redis_metrics status failed adapter=%s", adapter, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def record_quality_event(adapter: str, kind: str) -> None:
    """Rolling-window signal for deep monitoring (malformed CoAP, WS reconnect churn, poll fails)."""
    prefix = ADAPTER_PREFIX.get(adapter)
    if not prefix:
        return
    r = _redis()
    if r is None:
        return
    try:
        now = time.time()
        zkey = f"{prefix}:quality_events"
        member = f"{now:.3f}:{kind[:64]}:{uuid.uuid4().hex[:10]}"
        pipe = r.pipeline()
        pipe.zadd(zkey, {member: now})
        pipe.zremrangebyscore(zkey, 0, now - QUALITY_EVENTS_MAX_AGE_SEC - 60)
        pipe.execute()
    except Exception:
        log.debug("ingress_redis_metrics quality_event failed adapter=%s", adapter, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def record_poll_attempt(adapter: str, *, ok: bool) -> None:
    """REST poller: count HTTP polls and failures (non-2xx / transport)."""
    prefix = ADAPTER_PREFIX.get(adapter)
    if not prefix:
        return
    r = _redis()
    if r is None:
        return
    try:
        now = _iso()
        pipe = r.pipeline()
        pipe.hincrby(_stats_key(prefix), "poll_total", 1)
        pipe.hset(_stats_key(prefix), "last_poll_at", now)
        if not ok:
            pipe.hincrby(_stats_key(prefix), "poll_fail_total", 1)
        pipe.execute()
        _flush_snapshot(r, prefix)
    except Exception:
        log.debug("ingress_redis_metrics poll failed adapter=%s", adapter, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass
