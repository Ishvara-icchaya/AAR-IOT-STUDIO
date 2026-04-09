"""Optional Redis client for alert summaries and publish hints."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import settings

log = logging.getLogger(__name__)
_client: Any = None
_failed = False


def get_redis() -> Any | None:
    global _client, _failed
    if _failed:
        return None
    if _client is None:
        try:
            import redis

            _client = redis.from_url(settings.redis_url, decode_responses=True)
            _client.ping()
        except Exception:
            log.debug("redis unavailable; alert cache keys skipped", exc_info=True)
            _failed = True
            return None
    return _client
