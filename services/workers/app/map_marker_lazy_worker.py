"""Optional lazy helper for dashboard map marker cache.

``POST /api/v1/map-runtime/markers/query`` stores short-lived read-through responses in Redis
(see ``app.services.map_runtime_redis`` in the API). Identical site + binding fingerprints share
one entry, so multiple map widgets on one dashboard do not each trigger a full DB scan.

This process drains an explicit invalidation queue so ingest or ops can drop stale cache keys
without waiting for TTL (default 30s).

Environment
-----------
- ``REDIS_URL`` (or compose default ``redis://redis:6379/0``)
- ``MAP_LAZY_WORKER_ENABLED=true`` to run the loop

Queue (Redis ``BLPOP``)
-----------------------
List name: ``aar:map:lazy:invalidate`` — each message is a **full** cache key string
(``aar:map:markers_query:v1:...``) to ``DEL``. Producers can LPUSH keys after bulk updates.

Example::

    redis-cli LPUSH aar:map:lazy:invalidate 'aar:map:markers_query:v1:...'
"""

from __future__ import annotations

import logging
import os
import sys

from app.logging_setup import configure_logging

configure_logging()

log = logging.getLogger(__name__)

QUEUE_KEY = "aar:map:lazy:invalidate"
LISTEN_SEC = 30


def _redis():
    url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    try:
        import redis

        return redis.from_url(url, decode_responses=True, socket_connect_timeout=3, socket_timeout=5)
    except Exception:
        return None


def main() -> None:
    if os.environ.get("MAP_LAZY_WORKER_ENABLED", "").lower() not in ("1", "true", "yes", "on"):
        log.info("map_marker_lazy_worker: MAP_LAZY_WORKER_ENABLED not set; exiting.")
        return
    r = _redis()
    if r is None:
        log.error("map_marker_lazy_worker: redis client unavailable")
        sys.exit(1)
    log.info("map_marker_lazy_worker: draining %s", QUEUE_KEY)
    try:
        while True:
            item = r.brpop(QUEUE_KEY, timeout=LISTEN_SEC)
            if not item:
                continue
            _, key = item
            if not key or not isinstance(key, str):
                continue
            try:
                n = r.delete(key)
                log.debug("map_marker_lazy_worker: DEL %s -> %s", key, n)
            except Exception:
                log.warning("map_marker_lazy_worker: delete failed key=%s", key, exc_info=True)
    finally:
        try:
            r.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
