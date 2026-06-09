"""Post–v2_resolution linkage: DB backfill + Redis fingerprint migration (endpoint version identity)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from psycopg2.extras import Json

log = logging.getLogger(__name__)


def _redis():
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        return None
    try:
        import redis

        return redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=3)
    except Exception:
        log.debug("version_identity_linkage: redis unavailable", exc_info=True)
        return None


def redis_fingerprint_keys(
    *, endpoint_id: str, device_id: str, pk_hash: str | None, resolved_device_id: str | None
) -> tuple[str | None, str, str | None]:
    """Bootstrap key (pk), legacy ep+device key, steady-state rdev key."""
    legacy = f"version:fingerprint:ep:{endpoint_id}:dev:{device_id}"
    boot = f"version:fingerprint:endpoint:{endpoint_id}:pk:{pk_hash}" if pk_hash else None
    rdev = f"version:fingerprint:rdev:{resolved_device_id}" if resolved_device_id else None
    return boot, legacy, rdev


def migrate_redis_fingerprint_to_rdev(
    *,
    endpoint_id: str,
    device_id: str,
    pk_hash: str | None,
    resolved_device_id: str,
) -> None:
    """Copy last fingerprint from bootstrap / legacy keys to ``rdev``; delete source keys."""
    r = _redis()
    if not r or not resolved_device_id:
        return
    boot, legacy, rdev_key = redis_fingerprint_keys(
        endpoint_id=endpoint_id, device_id=device_id, pk_hash=pk_hash, resolved_device_id=resolved_device_id
    )
    if not rdev_key:
        return
    chosen: str | None = None
    try:
        if boot:
            chosen = r.get(boot) or chosen
        if not chosen:
            chosen = r.get(legacy)
    except Exception:
        log.debug("version_identity_linkage redis get failed", exc_info=True)
        return
    if not chosen:
        return
    try:
        r.set(rdev_key, chosen)
        r.delete(legacy)
        if boot:
            r.delete(boot)
    except Exception:
        log.debug("version_identity_linkage redis migrate failed", exc_info=True)


def apply_version_identity_linkage_sql(
    cur,
    *,
    device_id: str,
    endpoint_id: str,
    resolved_device_id: str,
) -> None:
    """Backfill ``resolved_device_id`` on detection events + consumer ``device_versions`` rows."""
    cur.execute(
        """
        UPDATE version_detection_events
        SET resolved_device_id = %s::uuid
        WHERE resolved_device_id IS NULL
          AND device_id = %s::uuid
          AND endpoint_id = %s::uuid
        """,
        (resolved_device_id, device_id, endpoint_id),
    )
    cur.execute(
        """
        UPDATE device_versions dv
        SET resolved_device_id = %s::uuid
        FROM version_detection_events vde
        WHERE dv.created_from_detection_event_id = vde.id
          AND dv.resolved_device_id IS NULL
          AND vde.device_id = %s::uuid
          AND vde.endpoint_id = %s::uuid
        """,
        (resolved_device_id, device_id, endpoint_id),
    )


def merge_lds_version_identity_for_resolution(
    cur,
    *,
    resolved_device_id: str,
    endpoint_id: str,
    device_id: str,
    now: datetime,
) -> None:
    """Refresh ``latest_device_state.system_json.version_identity`` from latest linked detection event."""
    cur.execute(
        """
        SELECT vde.fingerprint, vde.value_snapshot, vde.detected_at, vde.id::text
        FROM version_detection_events vde
        WHERE vde.endpoint_id = %s::uuid
          AND vde.device_id = %s::uuid
          AND vde.resolved_device_id = %s::uuid
        ORDER BY vde.detected_at DESC
        LIMIT 1
        """,
        (endpoint_id, device_id, resolved_device_id),
    )
    row = cur.fetchone()
    if not row:
        return
    fingerprint, value_snapshot, detected_at, ev_id = row
    snap = value_snapshot if isinstance(value_snapshot, dict) else None
    sw = None
    if isinstance(snap, dict):
        for k in ("software_version", "firmware_version", "version", "app_version", "fw"):
            v = snap.get(k)
            if v is not None:
                s = str(v).strip()
                if s:
                    sw = s[:128]
                    break
    observed = (detected_at or now).isoformat()
    vi: dict[str, Any] = {
        "fingerprint": str(fingerprint or ""),
        "changed": True,
        "pending_validation": True,
        "observed_at": observed,
        "detection_event_id": str(ev_id),
    }
    if sw:
        vi["software_version"] = sw
    if snap:
        for k in ("firmware_version", "config_version", "version", "build"):
            v = snap.get(k)
            if isinstance(v, (str, int, float, bool)):
                vi[str(k)] = v
    patch = {"version_identity": vi}
    cur.execute(
        """
        UPDATE latest_device_state
        SET system_json = COALESCE(system_json, '{}'::jsonb) || %s::jsonb,
            updated_at = %s
        WHERE resolved_device_id = %s::uuid
        """,
        (Json(patch), now, resolved_device_id),
    )


def reconcile_after_v2_resolution(
    *,
    device_id: str,
    endpoint_id: str,
    resolved_device_id: str,
    pk_hash: str | None,
) -> None:
    """Run after successful v2 commit: Redis migrate + DB linkage + LDS merge (best-effort)."""
    migrate_redis_fingerprint_to_rdev(
        endpoint_id=endpoint_id,
        device_id=device_id,
        pk_hash=pk_hash,
        resolved_device_id=resolved_device_id,
    )
    if not _truthy_linkage():
        return
    from app.db_url import db_url
    import psycopg2

    now = datetime.now(timezone.utc)
    conn = psycopg2.connect(db_url())
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            apply_version_identity_linkage_sql(
                cur,
                device_id=device_id,
                endpoint_id=endpoint_id,
                resolved_device_id=resolved_device_id,
            )
            merge_lds_version_identity_for_resolution(
                cur,
                resolved_device_id=resolved_device_id,
                endpoint_id=endpoint_id,
                device_id=device_id,
                now=now,
            )
        conn.commit()
        log.debug(
            "version_identity_linkage reconciled device_id=%s endpoint_id=%s rdev=%s",
            device_id,
            endpoint_id,
            resolved_device_id,
        )
    except Exception:
        conn.rollback()
        log.warning(
            "version_identity_linkage sql failed device_id=%s endpoint_id=%s",
            device_id,
            endpoint_id,
            exc_info=True,
        )
    finally:
        conn.close()


def _truthy_linkage() -> bool:
    v = os.environ.get("ENDPOINT_VERSION_IDENTITY_ENABLED", "").strip().lower()
    return v in ("1", "true", "yes", "on")
