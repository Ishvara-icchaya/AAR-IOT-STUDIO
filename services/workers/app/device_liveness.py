"""Transition-based device liveness worker (no repeated offline alerts)."""

from __future__ import annotations

import logging
import os
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

from app.alert_emit import emit_alert
from app.db_url import db_url
from app.logging_setup import configure_logging
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)

STATE_WAITING = "waiting_for_first_payload"
STATE_ONLINE = "online"
STATE_LATE = "late"
STATE_OFFLINE = "offline"
STATE_RECOVERED = "recovered"

_SITE_KEY = "aar:liveness:v1:site:{sid}"
_CUSTOMER_KEY = "aar:liveness:v1:customer:{cid}"
_SRV_SITE_KEY = "aar:liveness:srv:v1:site:{sid}"
_SRV_CUSTOMER_KEY = "aar:liveness:srv:v1:customer:{cid}"


def _redis_client() -> Any | None:
    url = os.environ.get("REDIS_URL", "")
    if not url:
        return None
    try:
        import redis

        r = redis.from_url(url, decode_responses=True)
        r.ping()
        return r
    except Exception:
        log.debug("device_liveness: redis unavailable", exc_info=True)
        return None


def _truthy(name: str, default: bool = True) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return None


def _is_operationally_suppressed(rec: dict[str, Any]) -> bool:
    dev_stat = str(rec.get("device_operational_status") or "active").strip().lower()
    ep_stat = str(rec.get("endpoint_operational_status") or "active").strip().lower()
    if dev_stat in {"inactive", "archived", "maintenance", "suppressed"}:
        return True
    if ep_stat in {"inactive", "archived", "maintenance", "suppressed"}:
        return True
    return False


def _effective_last_seen(rec: dict[str, Any]) -> datetime | None:
    # Endpoint payload timestamps are the source-of-truth for endpoint-bound ingest.
    ep_seen = _parse_ts(rec.get("endpoint_last_payload_at"))
    dev_seen = _parse_ts(rec.get("device_last_seen_at"))
    # If a device_endpoints row exists but nothing was archived yet, do not fall back to
    # device-only last_seen — avoids "Online" with zero payload for that endpoint.
    ep_row = rec.get("endpoint_is_active")
    if ep_row is not None and ep_seen is None:
        return None
    if ep_seen and dev_seen:
        return ep_seen if ep_seen >= dev_seen else dev_seen
    return ep_seen or dev_seen


def _target_state(rec: dict[str, Any], now: datetime) -> str:
    if not bool(rec.get("device_is_active", True)):
        return STATE_WAITING
    if not bool(rec.get("endpoint_is_active", True)):
        return STATE_WAITING
    if _is_operationally_suppressed(rec):
        return STATE_WAITING

    seen = _effective_last_seen(rec)
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


def _emit_transition_alert(rec: dict[str, Any], prev_state: str, next_state: str) -> str | None:
    """Emit alerts on transitions only and return alerted state."""
    device_name = str(rec.get("device_name") or rec.get("device_id"))
    customer_id = str(rec["customer_id"])
    site_id = str(rec["site_id"]) if rec.get("site_id") else None
    device_id = str(rec["device_id"])

    if next_state == STATE_LATE and prev_state == STATE_ONLINE:
        if not _truthy("DEVICE_LIVENESS_ALERT_ON_LATE", True):
            return None
        emit_alert(
            category="device_health",
            severity="warning",
            title=f"Device late: {device_name}",
            message="Device has not been seen within late threshold.",
            customer_id=customer_id,
            site_id=site_id,
            device_id=device_id,
            source_component="worker-device-liveness",
            source_object_type="device",
            source_object_id=device_id,
        )
        return STATE_LATE

    if next_state == STATE_OFFLINE and prev_state in {STATE_ONLINE, STATE_LATE}:
        emit_alert(
            category="device_health",
            severity="critical",
            title=f"Device offline: {device_name}",
            message="Device crossed offline threshold (transition-based alert).",
            customer_id=customer_id,
            site_id=site_id,
            device_id=device_id,
            source_component="worker-device-liveness",
            source_object_type="device",
            source_object_id=device_id,
        )
        return STATE_OFFLINE

    if prev_state == STATE_OFFLINE and next_state == STATE_RECOVERED:
        emit_alert(
            category="device_health",
            severity="info",
            title=f"Device recovered: {device_name}",
            message="Device moved from offline to recovered.",
            customer_id=customer_id,
            site_id=site_id,
            device_id=device_id,
            source_component="worker-device-liveness",
            source_object_type="device",
            source_object_id=device_id,
        )
        return STATE_RECOVERED
    return None


def _update_rollups(conn) -> None:
    r = _redis_client()
    if not r:
        return
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
              customer_id::text AS customer_id,
              site_id::text AS site_id,
              current_liveness_state,
              COUNT(*)::int AS cnt
            FROM devices
            GROUP BY customer_id, site_id, current_liveness_state
            """
        )
        rows = cur.fetchall()

    cust_roll: dict[str, dict[str, int]] = {}
    site_roll: dict[str, dict[str, int]] = {}
    states = (STATE_ONLINE, STATE_LATE, STATE_OFFLINE, STATE_WAITING)
    for row in rows:
        cid = str(row["customer_id"])
        sid = str(row["site_id"])
        st = str(row["current_liveness_state"] or STATE_WAITING)
        cnt = int(row["cnt"] or 0)
        if cid not in cust_roll:
            cust_roll[cid] = {k: 0 for k in states}
        if sid not in site_roll:
            site_roll[sid] = {k: 0 for k in states}
        if st not in cust_roll[cid]:
            continue
        cust_roll[cid][st] += cnt
        site_roll[sid][st] += cnt

    pipe = r.pipeline()
    for cid, vals in cust_roll.items():
        pipe.hset(_CUSTOMER_KEY.format(cid=cid), mapping=vals)
    for sid, vals in site_roll.items():
        pipe.hset(_SITE_KEY.format(sid=sid), mapping=vals)
    try:
        pipe.execute()
    except Exception:
        log.debug("device_liveness rollup write failed", exc_info=True)


def _update_srv_rollups(conn) -> None:
    """Enriched site/customer rollups for API Redis-first reads (counts mirror PG worker state).

    TODO(liveness): rollups only store ``last_seen_ts_max``; ``last_device_name`` in the API
    needs a richer structure (e.g. last_seen_ts_max + last_device_id with lexicographic tie-break).
    """
    r = _redis_client()
    if not r:
        return
    ts_ms = int(time.time() * 1000)
    states = (STATE_ONLINE, STATE_LATE, STATE_OFFLINE, STATE_WAITING)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"""
            SELECT
              site_id::text AS site_id,
              COALESCE(NULLIF(TRIM(current_liveness_state), ''), '{STATE_WAITING}') AS st,
              COUNT(*)::int AS cnt
            FROM devices
            WHERE site_id IS NOT NULL
            GROUP BY site_id,
              COALESCE(NULLIF(TRIM(current_liveness_state), ''), '{STATE_WAITING}')
            """
        )
        site_counts = cur.fetchall()
        cur.execute(
            """
            SELECT
              d.site_id::text AS site_id,
              COALESCE(
                CAST(
                  FLOOR(
                    EXTRACT(EPOCH FROM MAX(COALESCE(de.last_payload_at, d.last_seen_at))) * 1000
                  ) AS BIGINT
                ),
                0::bigint
              ) AS last_seen_ts_max
            FROM devices d
            LEFT JOIN device_endpoints de ON de.device_id = d.id
            WHERE d.site_id IS NOT NULL
            GROUP BY d.site_id
            """
        )
        site_max_seen = {str(r["site_id"]): int(r["last_seen_ts_max"] or 0) for r in cur.fetchall()}
        cur.execute(
            f"""
            SELECT
              customer_id::text AS customer_id,
              COALESCE(NULLIF(TRIM(current_liveness_state), ''), '{STATE_WAITING}') AS st,
              COUNT(*)::int AS cnt
            FROM devices
            GROUP BY customer_id,
              COALESCE(NULLIF(TRIM(current_liveness_state), ''), '{STATE_WAITING}')
            """
        )
        cust_counts = cur.fetchall()
        cur.execute(
            """
            SELECT
              d.customer_id::text AS customer_id,
              COALESCE(
                CAST(
                  FLOOR(
                    EXTRACT(EPOCH FROM MAX(COALESCE(de.last_payload_at, d.last_seen_at))) * 1000
                  ) AS BIGINT
                ),
                0::bigint
              ) AS last_seen_ts_max
            FROM devices d
            LEFT JOIN device_endpoints de ON de.device_id = d.id
            GROUP BY d.customer_id
            """
        )
        cust_max_seen = {str(r["customer_id"]): int(r["last_seen_ts_max"] or 0) for r in cur.fetchall()}

    site_roll: dict[str, dict[str, int]] = defaultdict(lambda: {k: 0 for k in states})
    for row in site_counts:
        sid = str(row["site_id"])
        st = str(row["st"])
        cnt = int(row["cnt"] or 0)
        if st == STATE_RECOVERED:
            st = STATE_ONLINE
        elif st not in states:
            st = STATE_WAITING
        site_roll[sid][st] += cnt

    cust_roll: dict[str, dict[str, int]] = defaultdict(lambda: {k: 0 for k in states})
    for row in cust_counts:
        cid = str(row["customer_id"])
        st = str(row["st"])
        cnt = int(row["cnt"] or 0)
        if st == STATE_RECOVERED:
            st = STATE_ONLINE
        elif st not in states:
            st = STATE_WAITING
        cust_roll[cid][st] += cnt

    pipe = r.pipeline()
    for sid, vals in site_roll.items():
        total = sum(int(vals[k]) for k in states)
        mapping = {
            STATE_ONLINE: str(vals[STATE_ONLINE]),
            STATE_LATE: str(vals[STATE_LATE]),
            STATE_OFFLINE: str(vals[STATE_OFFLINE]),
            STATE_WAITING: str(vals[STATE_WAITING]),
            "total": str(total),
            "rollup_updated_at_ms": str(ts_ms),
            "last_seen_ts_max": str(site_max_seen.get(sid, 0)),
        }
        pipe.hset(_SRV_SITE_KEY.format(sid=sid), mapping=mapping)
    for cid, vals in cust_roll.items():
        total = sum(int(vals[k]) for k in states)
        mapping = {
            STATE_ONLINE: str(vals[STATE_ONLINE]),
            STATE_LATE: str(vals[STATE_LATE]),
            STATE_OFFLINE: str(vals[STATE_OFFLINE]),
            STATE_WAITING: str(vals[STATE_WAITING]),
            "total": str(total),
            "rollup_updated_at_ms": str(ts_ms),
            "last_seen_ts_max": str(cust_max_seen.get(cid, 0)),
        }
        pipe.hset(_SRV_CUSTOMER_KEY.format(cid=cid), mapping=mapping)
    try:
        pipe.execute()
    except Exception:
        log.debug("device_liveness srv rollup write failed", exc_info=True)


def _scan_batch(conn, *, limit: int, offset: int) -> list[dict[str, Any]]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
              d.id AS device_id,
              d.customer_id,
              d.site_id,
              d.name AS device_name,
              d.is_active AS device_is_active,
              d.operational_status AS device_operational_status,
              d.last_seen_at AS device_last_seen_at,
              d.current_liveness_state,
              d.last_state_changed_at,
              d.last_alerted_state,
              d.expected_interval_seconds,
              d.late_threshold_seconds,
              d.offline_threshold_seconds,
              de.is_active AS endpoint_is_active,
              de.operational_status AS endpoint_operational_status,
              de.last_payload_at AS endpoint_last_payload_at
            FROM devices d
            LEFT JOIN device_endpoints de ON de.device_id = d.id
            ORDER BY d.id
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        return [dict(r) for r in cur.fetchall()]


def _process_once(batch_size: int = 500) -> None:
    now = _now()
    conn = psycopg2.connect(db_url())
    try:
        offset = 0
        while True:
            rows = _scan_batch(conn, limit=batch_size, offset=offset)
            if not rows:
                break
            offset += len(rows)
            with conn.cursor() as cur:
                for rec in rows:
                    prev_state = str(rec.get("current_liveness_state") or STATE_WAITING)
                    base_target = _target_state(rec, now)
                    # Recovered is a transition event/state (offline -> recovered), then settles to online next pass.
                    target = STATE_RECOVERED if prev_state == STATE_OFFLINE and base_target == STATE_ONLINE else base_target
                    seen = _effective_last_seen(rec)
                    if seen is not None and _parse_ts(rec.get("device_last_seen_at")) != seen:
                        cur.execute(
                            "UPDATE devices SET last_seen_at = %s WHERE id = %s::uuid",
                            (seen, str(rec["device_id"])),
                        )
                    if target == prev_state:
                        # Recovered should settle to online on the next pass without alert.
                        if target == STATE_RECOVERED:
                            cur.execute(
                                """
                                UPDATE devices
                                SET current_liveness_state = %s,
                                    last_state_changed_at = %s
                                WHERE id = %s::uuid
                                """,
                                (STATE_ONLINE, now, str(rec["device_id"])),
                            )
                        continue
                    # Avoid normal offline alerts for inactive/archived/suppressed/waiting.
                    if _is_operationally_suppressed(rec) or target == STATE_WAITING:
                        alerted = None
                    else:
                        alerted = _emit_transition_alert(rec, prev_state, target)
                    cur.execute(
                        """
                        UPDATE devices
                        SET current_liveness_state = %s,
                            last_state_changed_at = %s,
                            last_alerted_state = COALESCE(%s, last_alerted_state)
                        WHERE id = %s::uuid
                        """,
                        (target, now, alerted, str(rec["device_id"])),
                    )
                conn.commit()
        _update_rollups(conn)
        _update_srv_rollups(conn)
    finally:
        conn.close()


def main() -> None:
    start_worker_heartbeat("worker-device-liveness")
    sleep_s = int(os.environ.get("DEVICE_LIVENESS_SCAN_SECONDS", "15") or "15")
    batch_size = int(os.environ.get("DEVICE_LIVENESS_BATCH_SIZE", "500") or "500")
    log.info(
        "device_liveness started scan_seconds=%s batch_size=%s",
        sleep_s,
        batch_size,
    )
    while True:
        try:
            _process_once(batch_size=batch_size)
        except Exception:
            log.exception("device_liveness scan failed")
        time.sleep(max(5, sleep_s))


if __name__ == "__main__":
    main()
