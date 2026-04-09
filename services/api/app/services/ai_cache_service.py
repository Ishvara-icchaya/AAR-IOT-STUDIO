"""Short-TTL Redis cache for suggestions and optional chat hints."""

from __future__ import annotations

import json
from typing import Any

from app.core.config import settings
from app.core.redis_sync import get_redis


def cache_get_json(key: str) -> Any | None:
    r = get_redis()
    if not r:
        return None
    try:
        raw = r.get(key)
        if not raw:
            return None
        return json.loads(raw)
    except Exception:
        return None


def cache_set_json(key: str, value: Any, ttl_seconds: int | None = None) -> None:
    r = get_redis()
    if not r:
        return
    ttl = ttl_seconds if ttl_seconds is not None else settings.ai_suggestions_cache_ttl_seconds
    try:
        r.setex(key, max(30, int(ttl)), json.dumps(value, default=str))
    except Exception:
        pass
