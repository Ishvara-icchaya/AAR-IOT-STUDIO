"""Redis-backed status for asynchronous tenant operational data clears."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any
from uuid import UUID

from app.core.redis_sync import get_redis

log = logging.getLogger(__name__)

KEY_PREFIX = "opclear:v1:"
TTL_SECONDS = 86_400  # 24h — enough for long clears + polling


def _key(job_id: str) -> str:
    return f"{KEY_PREFIX}{job_id}"


def redis_available() -> bool:
    return get_redis() is not None


def create_job(customer_id: UUID) -> str:
    r = get_redis()
    if r is None:
        raise RuntimeError("Redis unavailable")
    job_id = str(uuid.uuid4())
    payload: dict[str, Any] = {
        "job_id": job_id,
        "customer_id": str(customer_id),
        "status": "queued",
        "phase": "queued",
        "deleted_counts": {},
        "error": None,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    r.set(_key(job_id), json.dumps(payload), ex=TTL_SECONDS)
    return job_id


def _load(job_id: str) -> dict[str, Any] | None:
    r = get_redis()
    if r is None:
        return None
    raw = r.get(_key(job_id))
    if not raw:
        return None
    return json.loads(raw)


def get_job(job_id: str, *, customer_id: UUID) -> dict[str, Any] | None:
    data = _load(job_id)
    if data is None:
        return None
    if data.get("customer_id") != str(customer_id):
        return None
    return data


def patch_job(job_id: str, **updates: Any) -> None:
    r = get_redis()
    if r is None:
        return
    key = _key(job_id)
    raw = r.get(key)
    if not raw:
        log.warning("opclear patch missing key job_id=%s", job_id)
        return
    data = json.loads(raw)
    data.update(updates)
    data["updated_at"] = time.time()
    r.set(key, json.dumps(data), ex=TTL_SECONDS)


def run_clear_job(job_id: str, customer_id: UUID) -> None:
    """Executed via FastAPI BackgroundTasks: own DB session, never blocks HTTP."""
    from app.db.session import SessionLocal
    from app.services.tenant_data_clear import clear_operational_data_except_sites

    def progress(payload: dict[str, Any]) -> None:
        patch_job(
            job_id,
            status="running",
            phase=str(payload.get("phase", "running")),
            deleted_counts=payload.get("deleted_counts") or {},
        )

    patch_job(job_id, status="running", phase="starting", deleted_counts={})
    db = SessionLocal()
    try:
        stats = clear_operational_data_except_sites(db, customer_id, progress=progress)
        db.commit()
        patch_job(
            job_id,
            status="completed",
            phase="done",
            deleted_counts=stats,
            error=None,
        )
        log.info(
            "opclear job completed job_id=%s customer_id=%s keys=%s",
            job_id,
            customer_id,
            sorted(stats.keys()),
        )
    except Exception as e:
        db.rollback()
        log.exception("opclear job failed job_id=%s", job_id)
        patch_job(job_id, status="failed", phase="error", error=str(e))
    finally:
        db.close()
