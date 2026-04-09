"""Redis NX+TTL cooldown for alert emission (non-publish paths).

Publish failures keep their streak policy in ``publish_failure_alerts``.
Monitoring probes use per-check keys in ``monitoring.py``.
"""

from __future__ import annotations

import logging

from app.core.redis_sync import get_redis

log = logging.getLogger(__name__)


def redis_cooldown_allows_emit(*, key: str, ttl_seconds: int) -> bool:
    """Return True if the caller should emit an alert (cooldown key was free)."""
    ex = max(60, int(ttl_seconds))
    r = get_redis()
    if not r:
        return True
    try:
        return bool(r.set(key, "1", nx=True, ex=ex))
    except Exception:
        log.debug("alert dedupe redis skip key=%s", key, exc_info=True)
        return True
