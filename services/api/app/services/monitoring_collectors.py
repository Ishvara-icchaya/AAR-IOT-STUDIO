"""Low-level connectivity and resource probes (read-only; no alert emission)."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Generator

from sqlalchemy import text

from app.core.config import settings

log = logging.getLogger(__name__)


@contextmanager
def redis_monitoring_client() -> Generator[Any | None, None, None]:
    """Short-lived Redis client for monitoring reads (avoids api.core.redis_sync startup failure cache)."""
    try:
        import redis

        c = redis.from_url(
            settings.redis_url,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        try:
            c.ping()
            yield c
        finally:
            try:
                c.close()
            except Exception:
                pass
    except Exception:
        log.debug("redis_monitoring_client unavailable", exc_info=True)
        yield None


monitoring_redis_client = redis_monitoring_client


def probe_timescale() -> tuple[bool, str | None]:
    try:
        from app.db.session import timescale_engine

        with timescale_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, None
    except Exception as e:
        return False, str(e)[:500]


def probe_ollama() -> tuple[bool, str | None, dict | None]:
    base = (settings.ollama_base_url or "").rstrip("/")
    if not base:
        return False, "OLLAMA_BASE_URL empty", None
    try:
        import httpx

        r = httpx.get(f"{base}/api/tags", timeout=3.0)
        r.raise_for_status()
        return True, None, r.json()
    except Exception as e:
        return False, str(e)[:500], None


def self_process_resources() -> tuple[float | None, float | None]:
    """CPU % and RSS MB for the API process (Phase 1 host-local only)."""
    try:
        import psutil

        p = psutil.Process()
        mem_mb = round(p.memory_info().rss / (1024 * 1024), 1)
        cpu = round(p.cpu_percent(interval=0.05), 1)
        return cpu, mem_mb
    except Exception:
        return None, None


def host_memory_percent() -> float | None:
    """Host virtual memory use % (for overview metric cards)."""
    try:
        import psutil

        return round(float(psutil.virtual_memory().percent), 1)
    except Exception:
        return None
