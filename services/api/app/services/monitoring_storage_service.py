"""Storage layer sizing (Postgres metadata, TimescaleDB, Redis memory, MinIO stub)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def postgres_metadata_gb(db: Session) -> tuple[float | None, int | None]:
    """Database size (GB) and approximate connection count from metadata pool."""
    try:
        size_b = db.execute(text("SELECT pg_database_size(current_database())")).scalar()
        gb = round(int(size_b or 0) / (1024**3), 2)
        # session count is cluster-wide; good enough as a hint
        conns = db.execute(
            text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")
        ).scalar()
        return gb, int(conns or 0)
    except Exception:
        log.debug("postgres_metadata_gb failed", exc_info=True)
        return None, None


def timescale_database_gb() -> float | None:
    """TimescaleDB size (GB); None if unreachable."""
    try:
        from app.db.session import timescale_engine

        with timescale_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            size_b = conn.execute(text("SELECT pg_database_size(current_database())")).scalar()
        return round(int(size_b or 0) / (1024**3), 2)
    except Exception:
        log.debug("timescale_database_gb failed", exc_info=True)
        return None


def redis_memory_used_mb(r: Any | None) -> float | None:
    if r is None:
        return None
    try:
        info = r.info(section="memory")
        used = info.get("used_memory")
        if used is None:
            return None
        return round(int(used) / (1024 * 1024), 2)
    except Exception:
        return None


def build_storage_rows(
    *,
    db: Session,
    redis_client: Any | None,
    postgres_ok: bool,
    timescale_ok: bool,
    redis_ok: bool,
    minio_ok: bool,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pg_gb, pg_conns = postgres_metadata_gb(db) if postgres_ok else (None, None)
    ts_gb = timescale_database_gb() if timescale_ok else None
    redis_mb = redis_memory_used_mb(redis_client) if redis_ok and redis_client else None

    rows.append(
        {
            "storage_layer": "postgres",
            "status": "healthy" if postgres_ok else "critical",
            "used_gb": pg_gb,
            "capacity_gb": None,
            "last_check": _now_iso(),
            "notes": f"connections (hint): {pg_conns}" if pg_conns is not None else None,
        }
    )
    rows.append(
        {
            "storage_layer": "timescaledb",
            "status": "healthy" if timescale_ok else "critical",
            "used_gb": ts_gb,
            "capacity_gb": None,
            "last_check": _now_iso(),
            "notes": "metadata DB size query" if ts_gb is not None else None,
        }
    )
    rows.append(
        {
            "storage_layer": "redis",
            "status": "healthy" if redis_ok else "critical",
            "used_gb": round(redis_mb / 1024, 3) if redis_mb is not None else None,
            "capacity_gb": None,
            "last_check": _now_iso(),
            "notes": f"memory ~{redis_mb} MB" if redis_mb is not None else "memory n/a",
        }
    )
    rows.append(
        {
            "storage_layer": "minio",
            "status": "healthy" if minio_ok else "critical",
            "used_gb": None,
            "capacity_gb": None,
            "last_check": _now_iso(),
            "notes": f"bucket {settings.minio_bucket_raw} (usage listing phase 2)",
        }
    )
    return rows
