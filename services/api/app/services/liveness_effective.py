"""Time-based device liveness (mirrors workers/app/device_liveness.py rules)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

STATE_WAITING = "waiting_for_first_payload"
STATE_ONLINE = "online"
STATE_LATE = "late"
STATE_OFFLINE = "offline"


def _parse_ts(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return None


def is_operationally_suppressed(rec: dict[str, Any]) -> bool:
    dev_stat = str(rec.get("device_operational_status") or "active").strip().lower()
    ep_stat = str(rec.get("endpoint_operational_status") or "active").strip().lower()
    if dev_stat in {"inactive", "archived", "maintenance", "suppressed"}:
        return True
    if ep_stat in {"inactive", "archived", "maintenance", "suppressed"}:
        return True
    return False


def effective_last_seen(rec: dict[str, Any]) -> datetime | None:
    ep_seen = _parse_ts(rec.get("endpoint_last_payload_at"))
    dev_seen = _parse_ts(rec.get("device_last_seen_at"))
    ep_row = rec.get("endpoint_is_active")
    if ep_row is not None and ep_seen is None:
        return None
    if ep_seen and dev_seen:
        return ep_seen if ep_seen >= dev_seen else dev_seen
    return ep_seen or dev_seen


def target_state(rec: dict[str, Any], now: datetime) -> str:
    if not bool(rec.get("device_is_active", True)):
        return STATE_WAITING
    if not bool(rec.get("endpoint_is_active", True)):
        return STATE_WAITING
    if is_operationally_suppressed(rec):
        return STATE_WAITING

    seen = effective_last_seen(rec)
    if not seen:
        return STATE_WAITING

    late_thr = int(rec.get("late_threshold_seconds") or 120)
    off_thr = int(rec.get("offline_threshold_seconds") or 300)
    if late_thr < 1:
        late_thr = 1
    if off_thr < late_thr:
        off_thr = late_thr
    age_s = max(0.0, (now - seen).total_seconds())
    if age_s >= off_thr:
        return STATE_OFFLINE
    if age_s >= late_thr:
        return STATE_LATE
    return STATE_ONLINE


def device_endpoint_row_to_rec(device: Any, ep: Any | None) -> dict[str, Any]:
    return {
        "device_id": device.id,
        "customer_id": device.customer_id,
        "site_id": device.site_id,
        "device_name": device.name,
        "device_is_active": device.is_active,
        "device_operational_status": device.operational_status,
        "device_last_seen_at": device.last_seen_at,
        "late_threshold_seconds": device.late_threshold_seconds,
        "offline_threshold_seconds": device.offline_threshold_seconds,
        "endpoint_is_active": ep.is_active if ep is not None else None,
        "endpoint_operational_status": ep.operational_status if ep is not None else None,
        "endpoint_last_payload_at": ep.last_payload_at if ep is not None else None,
    }
