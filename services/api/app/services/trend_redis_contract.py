"""Redis key helpers for MAP_POPUP_TREND_WINDOWS_CONTRACT (trend: prefix).

Writers (rollup workers) should SET window blobs with TTL:
  1h window → 5400s (90m), 24h window → 93600s (26h).

Readers tolerate missing keys (empty series).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.core.config import settings

log = logging.getLogger(__name__)


def trend_series_rdev_key(resolved_device_id: str, metric_key: str) -> str:
    return f"trend:rdev:{resolved_device_id}:{metric_key}:5m"


def trend_series_endpoint_key(endpoint_id: str, metric_key: str) -> str:
    return f"trend:endpoint:{endpoint_id}:{metric_key}:5m"


def trend_series_site_key(site_id: str, metric_key: str) -> str:
    return f"trend:site:{site_id}:{metric_key}:5m"


def trend_window_rdev_key(resolved_device_id: str, metric_key: str, window: str) -> str:
    return f"trend:window:rdev:{resolved_device_id}:{metric_key}:{window}"


def trend_window_endpoint_key(endpoint_id: str, metric_key: str, window: str) -> str:
    return f"trend:window:endpoint:{endpoint_id}:{metric_key}:{window}"


def trend_window_site_key(site_entity_id: str, metric_key: str, window: str) -> str:
    return f"trend:window:site:{site_entity_id}:{metric_key}:{window}"


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
        log.debug("trend_redis_contract client unavailable", exc_info=True)
        return None


def redis_client():
    """Caller should close() when done (matches map_runtime_redis pattern)."""
    return _client()


def window_key_for_scope(scope: str, entity_id: str, metric_key: str, window: str) -> str:
    if scope == "resolved_device":
        return trend_window_rdev_key(entity_id, metric_key, window)
    if scope == "endpoint":
        return trend_window_endpoint_key(entity_id, metric_key, window)
    if scope == "site":
        return trend_window_site_key(entity_id, metric_key, window)
    raise ValueError(f"unsupported scope {scope!r}")


def load_window_series_json(r: Any, key: str) -> list[dict[str, Any]] | None:
    """Load JSON array of bucket points from a STRING key."""
    try:
        raw = r.get(key)
        if not raw:
            return None
        data = json.loads(raw)
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict) and "buckets" in data:
            inner = data.get("buckets")
            if isinstance(inner, list):
                return [x for x in inner if isinstance(x, dict)]
        return None
    except Exception:
        log.debug("trend window read failed key=%s", key, exc_info=True)
        return None
