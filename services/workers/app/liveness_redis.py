"""Redis hints for liveness ingest (mirrors services/api/app/services/liveness_redis.py keys)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from psycopg2.extras import RealDictCursor

from app.device_liveness import (
    _effective_last_seen,
    _is_operationally_suppressed,
    _redis_client,
    _target_state,
)

log = logging.getLogger(__name__)

PREFIX = "aar:liveness:srv:v1"
DUE_LATE_Z = f"{PREFIX}:due:late"
DUE_OFFLINE_Z = f"{PREFIX}:due:offline"


def _device_key(device_id: uuid.UUID) -> str:
    return f"{PREFIX}:device:{device_id}"


def touch_publish_device_seen(cur: Any, device_id: uuid.UUID) -> None:
    r = _redis_client()
    if not r:
        return
    conn = cur.connection
    with conn.cursor(cursor_factory=RealDictCursor) as rcur:
        rcur.execute(
            """
            SELECT
              d.id AS device_id,
              d.customer_id,
              d.site_id,
              d.name AS device_name,
              d.is_active AS device_is_active,
              d.operational_status AS device_operational_status,
              d.last_seen_at AS device_last_seen_at,
              d.late_threshold_seconds,
              d.offline_threshold_seconds,
              de.is_active AS endpoint_is_active,
              de.operational_status AS endpoint_operational_status,
              de.last_payload_at AS endpoint_last_payload_at
            FROM devices d
            LEFT JOIN device_endpoints de ON de.device_id = d.id
            WHERE d.id = %s::uuid
            """,
            (str(device_id),),
        )
        row = rcur.fetchone()
    if not row:
        return
    rec = dict(row)
    now = datetime.now(timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    seen = _effective_last_seen(rec)
    ts_state = _target_state(rec, now)
    late_thr = int(rec.get("late_threshold_seconds") or 120)
    off_thr = int(rec.get("offline_threshold_seconds") or 300)
    if late_thr < 1:
        late_thr = 1
    if off_thr < late_thr:
        off_thr = late_thr

    dk = _device_key(device_id)
    mapping = {
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
            and not _is_operationally_suppressed(rec)
        ):
            base = int(seen.timestamp() * 1000)
            pipe.zadd(DUE_LATE_Z, {str(device_id): float(base + late_thr * 1000)})
            pipe.zadd(DUE_OFFLINE_Z, {str(device_id): float(base + off_thr * 1000)})
        pipe.execute()
    except Exception:
        log.debug("liveness_redis touch_publish failed", exc_info=True)
