"""Redis fast path for liveness ingest hints (Postgres remains source of truth)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.redis_sync import get_redis
from app.models.device import Device
from app.services.liveness_effective import (
    device_endpoint_row_to_rec,
    effective_last_seen,
    is_operationally_suppressed,
    target_state,
)

log = logging.getLogger(__name__)

PREFIX = "aar:liveness:srv:v1"
DUE_LATE_Z = f"{PREFIX}:due:late"
DUE_OFFLINE_Z = f"{PREFIX}:due:offline"


def device_hash_key(device_id: uuid.UUID) -> str:
    return f"{PREFIX}:device:{device_id}"


def site_rollup_key(site_id: uuid.UUID) -> str:
    return f"{PREFIX}:site:{site_id}"


def customer_rollup_key(customer_id: uuid.UUID) -> str:
    return f"{PREFIX}:customer:{customer_id}"


def _load_device_for_touch(db: Session, device_id: uuid.UUID) -> Device | None:
    stmt = (
        select(Device)
        .options(selectinload(Device.endpoint))
        .where(Device.id == device_id)
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def touch_publish_device_seen(db: Session, device_id: uuid.UUID) -> None:
    """After a successful ingest touch in Postgres, refresh Redis device hints + due ZSETs."""
    r = get_redis()
    if not r:
        return
    dev = _load_device_for_touch(db, device_id)
    if dev is None:
        return
    ep = dev.endpoint
    rec = device_endpoint_row_to_rec(dev, ep)
    now = datetime.now(timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    seen = effective_last_seen(rec)
    ts_state = target_state(rec, now)
    late_thr = int(rec.get("late_threshold_seconds") or 120)
    off_thr = int(rec.get("offline_threshold_seconds") or 300)
    if late_thr < 1:
        late_thr = 1
    if off_thr < late_thr:
        off_thr = late_thr

    dk = device_hash_key(device_id)
    mapping: dict[str, str] = {
        "customer_id": str(rec["customer_id"]),
        "site_id": str(rec["site_id"]),
        "last_seen_ts_ms": str(int(seen.timestamp() * 1000)) if seen else "0",
        "rollup_hint_state": ts_state,
        "late_threshold_s": str(late_thr),
        "offline_threshold_s": str(off_thr),
        "updated_at_ms": str(now_ms),
    }
    try:
        pipe = r.pipeline()
        pipe.hset(dk, mapping=mapping)
        pipe.hincrby(dk, "seen_seq", 1)
        pipe.zrem(DUE_LATE_Z, str(device_id))
        pipe.zrem(DUE_OFFLINE_Z, str(device_id))
        if (
            seen
            and bool(rec.get("device_is_active", True))
            and bool(rec.get("endpoint_is_active", True))
            and not is_operationally_suppressed(rec)
        ):
            base = int(seen.timestamp() * 1000)
            pipe.zadd(DUE_LATE_Z, {str(device_id): float(base + late_thr * 1000)})
            pipe.zadd(DUE_OFFLINE_Z, {str(device_id): float(base + off_thr * 1000)})
        pipe.execute()
    except Exception:
        log.debug("liveness_redis touch_publish failed", exc_info=True)
