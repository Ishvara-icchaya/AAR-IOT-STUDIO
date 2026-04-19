"""Increment per-site object counts in Redis (Phase D; workers only)."""

from __future__ import annotations

import logging
import os
from typing import Literal

log = logging.getLogger(__name__)

Kind = Literal["do", "ro"]


def _redis():
    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    try:
        import redis

        return redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def rollup_incr_site(*, customer_id: str, site_id: str, kind: Kind) -> None:
    """HINCRBY site hash + refresh customer ZSET score = do + ro."""
    r = _redis()
    if not r:
        return
    try:
        hkey = f"aar:rollup:v1:site:{site_id}"
        field = "do" if kind == "do" else "ro"
        r.hincrby(hkey, field, 1)
        do = int(r.hget(hkey, "do") or 0)
        ro = int(r.hget(hkey, "ro") or 0)
        zkey = f"aar:rollup:v1:customer:{customer_id}:sites_by_total"
        r.zadd(zkey, {site_id: float(do + ro)})
    except Exception:
        log.debug("tenant rollup incr failed", exc_info=True)
