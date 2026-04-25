"""Redis-first ops KPIs with Postgres timestamp recompute when rollups are missing/stale.

TODO(liveness): ``last_device_name`` is not populated on the Redis rollup path. Serving only
has ``last_seen_ts_max`` per scope, which is insufficient: ties at the same instant need a
defined ordering (e.g. max (seen_ts_ms, device_id)) and durable fields on rollups or a
small side structure (top-k / materialized view), not ad hoc max(name).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.redis_sync import get_redis
from app.models.device import Device
from app.services.liveness_effective import (
    STATE_LATE,
    STATE_OFFLINE,
    STATE_ONLINE,
    STATE_WAITING,
    device_endpoint_row_to_rec,
    effective_last_seen,
    target_state,
)
from app.services.liveness_redis import customer_rollup_key, site_rollup_key

_STATE_KEYS = (STATE_ONLINE, STATE_LATE, STATE_OFFLINE, STATE_WAITING)


def _freshness_ms() -> int:
    raw = os.environ.get("LIVENESS_REDIS_ROLLUP_FRESHNESS_MS", "45000")
    try:
        v = int(raw)
        return max(5_000, min(v, 600_000))
    except ValueError:
        return 45_000


def _parse_int(h: dict[str, str], k: str) -> int:
    try:
        return int(h.get(k) or 0)
    except ValueError:
        return 0


def _rollup_from_hash(h: dict[str, str]) -> dict[str, int] | None:
    if not h:
        return None
    out: dict[str, int] = {k: _parse_int(h, k) for k in _STATE_KEYS}
    total = _parse_int(h, "total")
    if total <= 0:
        total = sum(out.values())
    out["total"] = total
    out["rollup_updated_at_ms"] = _parse_int(h, "rollup_updated_at_ms")
    out["last_seen_ts_max"] = _parse_int(h, "last_seen_ts_max")
    return out


def _merge_site_rollups(
    r: Any,
    *,
    site_ids: list[uuid.UUID],
    now_ms: int,
    freshness_ms: int,
) -> dict[str, int] | None:
    merged = {STATE_ONLINE: 0, STATE_LATE: 0, STATE_OFFLINE: 0, STATE_WAITING: 0, "total": 0}
    min_updated: int | None = None
    max_seen: int = 0
    for sid in site_ids:
        h = r.hgetall(site_rollup_key(sid))
        row = _rollup_from_hash(h)
        if row is None:
            return None
        ru = int(row.get("rollup_updated_at_ms", 0) or 0)
        if ru <= 0 or now_ms - ru > freshness_ms:
            return None
        min_updated = ru if min_updated is None else min(min_updated, ru)
        for k in _STATE_KEYS:
            merged[k] += int(row[k])
        merged["total"] += int(row["total"])
        mxs = int(row.get("last_seen_ts_max", 0) or 0)
        if mxs > max_seen:
            max_seen = mxs
    merged["rollup_updated_at_ms"] = min_updated or 0
    merged["last_seen_ts_max"] = max_seen
    return merged


def _customer_rollup_fresh(r: Any, customer_id: uuid.UUID, now_ms: int, freshness_ms: int) -> dict[str, int] | None:
    h = r.hgetall(customer_rollup_key(customer_id))
    row = _rollup_from_hash(h)
    if row is None:
        return None
    ru = int(row.get("rollup_updated_at_ms", 0) or 0)
    if ru <= 0 or now_ms - ru > freshness_ms:
        return None
    return row


def _relative_from_ms(now_ms: int, seen_ms: int) -> str:
    if seen_ms <= 0:
        return "—"
    delta_s = max(0, (now_ms - seen_ms) // 1000)
    if delta_s < 60:
        return "just now"
    if delta_s < 3600:
        return f"{int(delta_s // 60)}m ago"
    if delta_s < 86400:
        return f"{int(delta_s // 3600)}h ago"
    return f"{int(delta_s // 86400)}d ago"


def _recompute_from_postgres(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    now: datetime,
) -> dict[str, Any]:
    now_ms = int(now.timestamp() * 1000)
    stmt = (
        select(Device)
        .options(selectinload(Device.endpoint))
        .where(Device.customer_id == customer_id)
    )
    if allowed_site_ids is not None:
        stmt = stmt.where(Device.site_id.in_(allowed_site_ids))
    devices = db.execute(stmt).scalars().all()
    counts = {STATE_ONLINE: 0, STATE_LATE: 0, STATE_OFFLINE: 0, STATE_WAITING: 0}
    max_seen_ms = 0
    last_name: str | None = None
    for d in devices:
        rec = device_endpoint_row_to_rec(d, d.endpoint)
        st = target_state(rec, now)
        counts[st] = counts.get(st, 0) + 1
        seen = effective_last_seen(rec)
        if seen:
            sms = int(seen.timestamp() * 1000)
            # TODO(liveness): tie-break when sms == max_seen_ms (e.g. compare device_id), same as Redis rollup design.
            if sms >= max_seen_ms:
                max_seen_ms = sms
                last_name = d.name
    total = len(devices)
    online = counts[STATE_ONLINE]
    late = counts[STATE_LATE]
    offline = counts[STATE_OFFLINE]
    waiting = counts[STATE_WAITING]
    degraded = late + waiting
    return {
        "total_devices": total,
        "online": online,
        "degraded": degraded,
        "offline": offline,
        "last_data_relative": _relative_from_ms(now_ms, max_seen_ms),
        "last_device_name": last_name,
        "asof_ts": now.isoformat(),
        "freshness_ms": 0,
        "status_source": "postgres_recompute",
    }


def ops_overview_kpis_serving(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
) -> dict[str, Any]:
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        now = datetime.now(timezone.utc)
        return {
            "total_devices": 0,
            "online": 0,
            "degraded": 0,
            "offline": 0,
            "last_data_relative": "—",
            "last_device_name": None,
            "asof_ts": now.isoformat(),
            "freshness_ms": 0,
            "status_source": "postgres_recompute",
        }
    now = datetime.now(timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    freshness_ms = _freshness_ms()
    r = get_redis()
    merged: dict[str, int] | None = None
    status_source = "postgres_recompute"

    if r is not None:
        if allowed_site_ids is None:
            merged = _customer_rollup_fresh(r, customer_id, now_ms, freshness_ms)
            if merged is not None:
                status_source = "redis_rollup"
        elif len(allowed_site_ids) > 0:
            merged = _merge_site_rollups(r, site_ids=allowed_site_ids, now_ms=now_ms, freshness_ms=freshness_ms)
            if merged is not None:
                status_source = "redis_rollup"

    if merged is not None:
        total = int(merged["total"])
        online = int(merged[STATE_ONLINE])
        late = int(merged[STATE_LATE])
        offline = int(merged[STATE_OFFLINE])
        waiting = int(merged[STATE_WAITING])
        degraded = late + waiting
        max_ms = int(merged.get("last_seen_ts_max", 0) or 0)
        return {
            "total_devices": total,
            "online": online,
            "degraded": degraded,
            "offline": offline,
            "last_data_relative": _relative_from_ms(now_ms, max_ms),
            # TODO(liveness): last_device_name — see module docstring; needs rollup / side-store + tie-break.
            "last_device_name": None,
            "asof_ts": now.isoformat(),
            "freshness_ms": now_ms - int(merged.get("rollup_updated_at_ms", 0) or 0),
            "status_source": status_source,
        }

    return _recompute_from_postgres(db, customer_id=customer_id, allowed_site_ids=allowed_site_ids, now=now)
