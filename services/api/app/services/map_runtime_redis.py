"""Redis keys for map runtime: latest object state, site indexes, KPI rolling series."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings

log = logging.getLogger(__name__)

PREFIX = "aar:map"
SITE_MEMBERS = f"{PREFIX}:site:"  # SET of "data_object:{uuid}" | "result_object:{uuid}"
STATE = f"{PREFIX}:state:"  # STRING JSON per object
AGG_STATS = f"{PREFIX}:aggregator:stats"  # HASH process visibility
KPI_SERIES_1H = f"{PREFIX}:kpi:series:1h:"  # STRING JSON
KPI_SERIES_24H = f"{PREFIX}:kpi:series:24h:"  # STRING JSON


def _client():
    try:
        import redis

        return redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    except Exception:
        log.debug("map_runtime_redis client unavailable", exc_info=True)
        return None


def redis_client():
    """Shared Redis connection for map runtime reads (caller must close when done)."""
    return _client()


def site_key(site_id: uuid.UUID | str) -> str:
    return f"{SITE_MEMBERS}{site_id}"


def state_key(customer_id: uuid.UUID | str, source_type: str, source_id: uuid.UUID | str) -> str:
    return f"{STATE}{customer_id}:{source_type}:{source_id}"


def kpi_series_key_1h(customer_id: uuid.UUID | str, source_type: str, source_id: uuid.UUID | str) -> str:
    return f"{KPI_SERIES_1H}{customer_id}:{source_type}:{source_id}"


def kpi_series_key_24h(customer_id: uuid.UUID | str, source_type: str, source_id: uuid.UUID | str) -> str:
    return f"{KPI_SERIES_24H}{customer_id}:{source_type}:{source_id}"


def member_token(source_type: str, source_id: uuid.UUID | str) -> str:
    return f"{source_type}:{source_id}"


def parse_member(m: str) -> tuple[str, uuid.UUID] | None:
    if ":" not in m:
        return None
    st, sid = m.split(":", 1)
    try:
        return st, uuid.UUID(sid)
    except ValueError:
        return None


def load_state_json(r: Any, key: str) -> dict[str, Any] | None:
    try:
        raw = r.get(key)
        if not raw:
            return None
        out = json.loads(raw)
        return out if isinstance(out, dict) else None
    except Exception:
        log.debug("map state read failed key=%s", key, exc_info=True)
        return None


def list_site_object_keys(r: Any, site_id: uuid.UUID) -> list[str]:
    try:
        sk = site_key(site_id)
        return list(r.smembers(sk)) if r.exists(sk) else []
    except Exception:
        log.debug("map site index read failed", exc_info=True)
        return []


def load_kpi_series(r: Any, key: str) -> dict[str, list[dict[str, Any]]]:
    try:
        raw = r.get(key)
        if not raw:
            return {}
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def aggregator_stats() -> dict[str, Any]:
    r = _client()
    if r is None:
        return {"redis_available": False}
    try:
        h = r.hgetall(AGG_STATS)
        return {"redis_available": True, **(h or {})}
    finally:
        try:
            r.close()
        except Exception:
            pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
