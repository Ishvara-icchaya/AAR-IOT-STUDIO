"""Redis TTL heartbeats so /monitoring/deep can detect stalled or dead pipeline workers."""

from __future__ import annotations

import logging
import os
import threading
import time

log = logging.getLogger(__name__)

KEY_PREFIX = "aar:worker:heartbeat:"


def _ttl_seconds() -> int:
    try:
        return max(30, int(os.environ.get("WORKER_HEARTBEAT_TTL_SECONDS", "90")))
    except ValueError:
        return 90


def _interval_seconds() -> float:
    try:
        return max(5.0, float(os.environ.get("WORKER_HEARTBEAT_INTERVAL_SECONDS", "30")))
    except ValueError:
        return 30.0


def touch(worker_id: str) -> None:
    url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    try:
        import redis

        r = redis.from_url(url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True)
        try:
            r.setex(KEY_PREFIX + worker_id, _ttl_seconds(), str(int(time.time())))
        finally:
            try:
                r.close()
            except Exception:
                pass
    except Exception:
        log.debug("worker heartbeat touch failed id=%s", worker_id, exc_info=True)


def start_daemon(worker_id: str) -> threading.Event:
    """Start a daemon thread that refreshes the heartbeat key. Returns stop Event."""
    stop = threading.Event()
    interval = _interval_seconds()

    def loop() -> None:
        touch(worker_id)
        while not stop.wait(interval):
            touch(worker_id)

    t = threading.Thread(target=loop, daemon=True, name=f"heartbeat-{worker_id}")
    t.start()
    return stop
