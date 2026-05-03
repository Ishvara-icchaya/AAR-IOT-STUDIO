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
            socket_connect_timeout=3,
            # Map marker batches can be large; 2s was timing out mid-pipeline (500 on markers/query).
            socket_timeout=8,
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


# Read-through cache for POST /map-runtime/markers/query (shared by duplicate map widgets).
MARKERS_QUERY_CACHE_PREFIX = f"{PREFIX}:markers_query:v1:"


def markers_query_body_digest(body: Any) -> str:
    import hashlib

    try:
        p = body.model_dump(mode="json", exclude_none=True)
    except Exception:
        p = {}
    sid = p.get("site_id")
    if sid is not None:
        p["site_id"] = str(sid)
    raw = json.dumps(p, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:48]


def markers_query_cache_key(customer_id: uuid.UUID, body: Any) -> str:
    return f"{MARKERS_QUERY_CACHE_PREFIX}{customer_id}:{body.site_id}:{markers_query_body_digest(body)}"


def cache_get_markers_query(cache_key: str) -> dict[str, Any] | None:
    r = _client()
    if r is None:
        return None
    try:
        raw = r.get(cache_key)
        if not raw:
            return None
        out = json.loads(raw)
        return out if isinstance(out, dict) else None
    except Exception:
        log.debug("map markers query cache get failed key=%s", cache_key, exc_info=True)
        return None
    finally:
        try:
            r.close()
        except Exception:
            pass


def cache_set_markers_query(cache_key: str, payload: dict[str, Any], *, ttl_sec: int = 30) -> None:
    r = _client()
    if r is None:
        return
    try:
        raw = json.dumps(payload, default=str)
        if len(raw.encode("utf-8")) > 1_800_000:
            return
        r.setex(cache_key, ttl_sec, raw)
    except Exception:
        log.debug("map markers query cache set failed key=%s", cache_key, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


def cache_delete_markers_query_key(cache_key: str) -> bool:
    """Used by optional lazy worker to drop one cached markers response."""
    r = _client()
    if r is None:
        return False
    try:
        return bool(r.delete(cache_key))
    except Exception:
        return False
    finally:
        try:
            r.close()
        except Exception:
            pass
