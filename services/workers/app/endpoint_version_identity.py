"""Pre-scrubber endpoint version identity: Redis fingerprint, Kafka (async DB by default).

See docs/ENDPOINT_VERSION_IDENTITY.md. When ``ENDPOINT_VERSION_IDENTITY_ASYNC_EVENTS`` is true (default),
the hot path does **not** insert ``version_detection_events``; the version-identity consumer does.

Auto-discovery: first-payload path scan when ``auto_discover`` is set, ``paths`` empty, and
``discovery_completed`` is false — persists ``paths``, ``discovery_completed``, ``discovered_at``.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import Json

from app.db_url import db_url
from app.kafka_publish import emit_version_identity_changed
from app.primary_device_key import compute_primary_key_hash, extract_primary_key_json

log = logging.getLogger(__name__)


def _list_of_str(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        s = str(item).strip()
        if s:
            out.append(s)
    return out


def _enabled() -> bool:
    v = os.environ.get("ENDPOINT_VERSION_IDENTITY_ENABLED", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _async_events() -> bool:
    return os.environ.get("ENDPOINT_VERSION_IDENTITY_ASYNC_EVENTS", "true").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _redis_client():
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        return None
    try:
        import redis

        return redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=3)
    except Exception:
        log.debug("endpoint_version_identity: redis unavailable", exc_info=True)
        return None


def _get_by_dotted_path(obj: Any, dotted: str) -> Any:
    """Resolve ``$.a.b`` or ``a.b`` against a dict tree (simple segments only)."""
    p = (dotted or "").strip().replace("$", "").lstrip(".")
    if not p:
        return None
    cur: Any = obj
    for part in p.split("."):
        if part == "":
            continue
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _canonical_fingerprint(values: dict[str, Any]) -> str:
    keys = sorted(values.keys())
    canon = {k: values[k] for k in keys}
    raw = json.dumps(canon, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _last_fingerprint_db(cur, *, device_id: str, endpoint_id: str) -> str | None:
    cur.execute(
        """
        SELECT fingerprint
        FROM version_detection_events
        WHERE device_id = %s::uuid AND endpoint_id = %s::uuid
        ORDER BY detected_at DESC
        LIMIT 1
        """,
        (device_id, endpoint_id),
    )
    row = cur.fetchone()
    return str(row[0]) if row and row[0] else None


def _redis_fingerprint_key(endpoint_id: str, device_id: str) -> str:
    return f"version:fingerprint:ep:{endpoint_id}:dev:{device_id}"


def _persist_endpoint_version_identity(*, endpoint_id: str, customer_id: str, cfg: dict[str, Any]) -> None:
    conn = psycopg2.connect(db_url())
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE endpoints
                SET version_identity = %s
                WHERE id = %s::uuid AND customer_id = %s::uuid
                """,
                (Json(cfg), str(endpoint_id), str(customer_id)),
            )
    finally:
        conn.close()


def _maybe_auto_discover_paths(
    cfg: dict[str, Any], payload: dict[str, Any], *, endpoint_id: str, customer_id: str
) -> dict[str, Any]:
    """First-payload scan: fill ``paths`` + ``discovery_completed`` / ``discovered_at`` when enabled."""
    if not cfg.get("auto_discover"):
        return cfg
    if cfg.get("discovery_completed"):
        return cfg
    paths = cfg.get("paths")
    if isinstance(paths, dict) and paths:
        return cfg
    discovered: dict[str, str] = {}
    for k in list(payload.keys()):
        if not isinstance(k, str):
            continue
        kl = k.lower()
        if not re.search(r"version|firmware|fw|software|config|build|app", kl):
            continue
        logical = re.sub(r"[^a-z0-9]+", "_", kl).strip("_")[:40] or "field"
        lk = logical
        n = 1
        while lk in discovered:
            n += 1
            lk = f"{logical}_{n}"
        discovered[lk] = k
    if not discovered:
        return cfg
    new_cfg = copy.deepcopy(cfg)
    new_cfg["paths"] = discovered
    new_cfg["discovery_completed"] = True
    new_cfg["discovered_at"] = datetime.now(timezone.utc).isoformat()
    if not new_cfg.get("fingerprint_fields"):
        new_cfg["fingerprint_fields"] = sorted(discovered.keys())[:24]
    try:
        _persist_endpoint_version_identity(endpoint_id=endpoint_id, customer_id=customer_id, cfg=new_cfg)
    except Exception:
        log.warning("endpoint_version_identity auto_discover persist failed endpoint_id=%s", endpoint_id, exc_info=True)
        return cfg
    log.info("endpoint_version_identity auto_discovered paths endpoint_id=%s keys=%s", endpoint_id, list(discovered.keys()))
    return new_cfg


def process_raw_version_identity(
    *,
    raw_bytes: bytes,
    content_type: str | None,
    endpoint_id: str | None,
    device_id: str,
    customer_id: str,
    site_id: str,
    raw_object_id: str,
    trace_id: str | None,
) -> None:
    """Runs after raw read, before scrubber. No-op unless ``ENDPOINT_VERSION_IDENTITY_ENABLED``."""
    if not _enabled() or not endpoint_id:
        return
    try:
        ep_uuid = uuid.UUID(str(endpoint_id).strip())
        dev_uuid = uuid.UUID(str(device_id).strip())
        cust_uuid = uuid.UUID(str(customer_id).strip())
        site_uuid = uuid.UUID(str(site_id).strip())
    except ValueError:
        log.debug("endpoint_version_identity skip: invalid uuid envelope")
        return

    r = _redis_client()

    conn = psycopg2.connect(db_url())
    ev_id: uuid.UUID | None = None
    fingerprint: str | None = None
    prev: str | None = None
    redis_write_keys: list[str] = []
    values: dict[str, Any] = {}
    rdev_id_s: str | None = None
    ro_uuid: uuid.UUID | None = None
    detected_at = datetime.now(timezone.utc)
    try:
        ro_uuid = uuid.UUID(str(raw_object_id).strip())
    except ValueError:
        ro_uuid = None

    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT version_identity, site_id, primary_device_key_fields
                FROM endpoints
                WHERE id = %s::uuid
                  AND customer_id = %s::uuid
                  AND enabled = true
                LIMIT 1
                """,
                (str(ep_uuid), str(cust_uuid)),
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return
            cfg_raw, ep_site, pk_fields_raw = row
            if str(ep_site) != str(site_uuid):
                log.warning(
                    "endpoint_version_identity site mismatch endpoint_id=%s ep_site=%s envelope_site=%s",
                    ep_uuid,
                    ep_site,
                    site_uuid,
                )
                conn.rollback()
                return
            cfg = cfg_raw if isinstance(cfg_raw, dict) else {}
            if not cfg.get("enabled"):
                conn.rollback()
                return

            try:
                text = raw_bytes.decode("utf-8")
                payload = json.loads(text)
            except (UnicodeDecodeError, json.JSONDecodeError):
                conn.rollback()
                return
            if not isinstance(payload, dict):
                conn.rollback()
                return

            cfg = _maybe_auto_discover_paths(cfg, payload, endpoint_id=str(ep_uuid), customer_id=str(cust_uuid))

            paths = cfg.get("paths")
            if not isinstance(paths, dict) or not paths:
                conn.rollback()
                return
            fp_fields = cfg.get("fingerprint_fields")
            if isinstance(fp_fields, list) and fp_fields:
                field_keys = [str(x).strip() for x in fp_fields if str(x).strip()]
            else:
                field_keys = sorted(str(k) for k in paths.keys())

            for logical in field_keys:
                path = paths.get(logical)
                if not isinstance(path, str) or not path.strip():
                    continue
                values[logical] = _get_by_dotted_path(payload, path.strip())

            fingerprint = _canonical_fingerprint(values)

            pk_fields = _list_of_str(pk_fields_raw)
            pk_json = extract_primary_key_json(payload, pk_fields) if pk_fields else None
            pk_hash: str | None = compute_primary_key_hash(pk_json) if pk_json else None
            rdev_id_s = None
            if pk_hash:
                cur.execute(
                    """
                    SELECT id::text FROM resolved_devices
                    WHERE endpoint_id = %s::uuid AND primary_key_hash = %s
                    LIMIT 1
                    """,
                    (str(ep_uuid), pk_hash),
                )
                rd_row = cur.fetchone()
                if rd_row and rd_row[0]:
                    rdev_id_s = str(rd_row[0])

            legacy_key = _redis_fingerprint_key(str(ep_uuid), str(dev_uuid))
            boot_key = f"version:fingerprint:endpoint:{ep_uuid}:pk:{pk_hash}" if pk_hash else None
            rdev_key = f"version:fingerprint:rdev:{rdev_id_s}" if rdev_id_s else None

            if r is not None:
                prev = None
                for k in (rdev_key, boot_key, legacy_key):
                    if not k:
                        continue
                    try:
                        prev = r.get(k)
                    except Exception:
                        log.debug("endpoint_version_identity redis get failed", exc_info=True)
                    if prev:
                        break
            else:
                prev = None

            if not prev:
                prev = _last_fingerprint_db(cur, device_id=str(dev_uuid), endpoint_id=str(ep_uuid))

            redis_write_keys = [k for k in (rdev_key, boot_key, legacy_key) if k]

            if prev == fingerprint:
                conn.rollback()
                return

            ev_id = uuid.uuid4()

            if _async_events():
                conn.rollback()
            else:
                cur.execute(
                    """
                    INSERT INTO version_detection_events (
                        id, customer_id, site_id, device_id, endpoint_id, resolved_device_id,
                        fingerprint, value_snapshot, raw_object_id, detected_at
                    ) VALUES (
                        %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
                        %s, %s, %s, %s
                    )
                    """,
                    (
                        str(ev_id),
                        str(cust_uuid),
                        str(site_uuid),
                        str(dev_uuid),
                        str(ep_uuid),
                        rdev_id_s,
                        fingerprint,
                        Json(values),
                        str(ro_uuid) if ro_uuid else None,
                        detected_at,
                    ),
                )
                conn.commit()
    except Exception:
        log.exception("endpoint_version_identity persistence failed raw_object_id=%s", raw_object_id)
        try:
            conn.rollback()
        except Exception:
            pass
        return
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if fingerprint is None or ev_id is None:
        return

    if r is not None and redis_write_keys:
        for rk in redis_write_keys:
            try:
                r.set(rk, fingerprint)
            except Exception:
                log.debug("endpoint_version_identity redis set failed key=%s", rk, exc_info=True)

    try:
        emit_version_identity_changed(
            {
                "kind": "version_identity_changed",
                "inline_detection_v2": _async_events(),
                "event_id": str(ev_id),
                "customer_id": str(cust_uuid),
                "site_id": str(site_uuid),
                "device_id": str(dev_uuid),
                "endpoint_id": str(ep_uuid),
                "resolved_device_id": rdev_id_s,
                "fingerprint": fingerprint,
                "value_snapshot": values,
                "previous_fingerprint": prev,
                "raw_object_id": str(raw_object_id),
                "trace_id": trace_id,
                "observed_at": detected_at.isoformat(),
                "detected_at": detected_at.isoformat(),
            }
        )
    except Exception:
        log.warning("endpoint_version_identity kafka emit failed raw_object_id=%s", raw_object_id, exc_info=True)
