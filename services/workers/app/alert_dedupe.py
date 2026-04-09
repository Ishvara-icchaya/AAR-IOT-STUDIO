"""Redis NX+TTL cooldown for worker-side alert emission."""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger(__name__)


def _redis() -> Any | None:
    url = os.environ.get("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis

        r = redis.from_url(url, decode_responses=True, socket_connect_timeout=2)
        r.ping()
        return r
    except Exception:
        log.debug("alert_dedupe redis skip", exc_info=True)
        return None


def workflow_failure_cooldown_allows(*, customer_id: str, workflow_id: str) -> bool:
    """Return True if a workflow failure alert may be emitted for this workflow."""
    try:
        ttl = max(60, int(os.environ.get("ALERT_DEDUPE_WORKFLOW_FAILURE_SECONDS", "600")))
    except ValueError:
        ttl = 600
    key = f"alert:dedupe:workflow:fail:{customer_id}:{workflow_id}"
    r = _redis()
    if not r:
        return True
    try:
        return bool(r.set(key, "1", nx=True, ex=ttl))
    except Exception:
        return True
