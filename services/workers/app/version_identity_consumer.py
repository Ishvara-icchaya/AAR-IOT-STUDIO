"""Consume ``version.identity.changed`` → ``version_detection_events`` + ``device_versions`` (detected), LDS flags.

Supports **inline_detection_v2** (hot path emits Kafka only) and legacy rows pre-inserted on the hot path.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
from kafka import KafkaConsumer
from psycopg2.extras import Json

from app._kafka import bootstrap_servers
from app.db_url import db_url
from app.logging_setup import configure_logging
from app.pipeline import emit
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def _truthy(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def _topic() -> str:
    return os.environ.get("KAFKA_VERSION_IDENTITY_TOPIC", "version.identity.changed")


def _group_id() -> str:
    return os.environ.get("VERSION_IDENTITY_CONSUMER_GROUP_ID", "worker-version-identity")


def _resolve_resolved_device_id(cur, *, device_id: str, endpoint_id: str) -> str | None:
    cur.execute(
        """
        SELECT rd.id::text
        FROM resolved_devices rd
        JOIN endpoints ep ON ep.id = rd.endpoint_id
        WHERE rd.endpoint_id = %s::uuid
          AND ep.device_endpoint_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM device_endpoints de
            WHERE de.id = ep.device_endpoint_id AND de.device_id = %s::uuid
          )
        ORDER BY rd.last_seen_at DESC NULLS LAST, rd.updated_at DESC NULLS LAST
        LIMIT 1
        """,
        (endpoint_id, device_id),
    )
    row = cur.fetchone()
    return str(row[0]) if row and row[0] else None


def _software_version_hint(snap: dict[str, Any] | None) -> str | None:
    if not isinstance(snap, dict):
        return None
    for k in ("software_version", "firmware_version", "version", "app_version", "fw"):
        v = snap.get(k)
        if v is not None:
            s = str(v).strip()
            if s:
                return s[:128]
    return None


def _version_label_for_fingerprint(fingerprint: str) -> str:
    fp = (fingerprint or "").strip()
    base = f"det-{fp[:20]}" if fp else "det-unknown"
    return base[:64]


def _bump_monotonic_label(label: str) -> str:
    """Next friendly display label after ``label`` (numeric tail or ``{base}-2``)."""
    s = (label or "").strip() or "1"
    if s.isdigit():
        try:
            return str(int(s, 10) + 1)
        except ValueError:
            pass
    m = re.match(r"^(.*?)(\d+)$", s)
    if m:
        prefix, num = m.group(1), m.group(2)
        try:
            return f"{prefix}{int(num, 10) + 1}"
        except ValueError:
            pass
    return f"{s}-2"


def _next_friendly_display(cur, *, device_id: str) -> str:
    """Monotonic friendly label after active governed display (or device cache), avoiding ``det-`` bases."""
    cur.execute(
        """
        SELECT display_version_label, version_label
        FROM device_versions
        WHERE device_id = %s::uuid
          AND routing_lane = 'shared'
          AND status = 'active'
        ORDER BY activated_at DESC NULLS LAST, created_at DESC
        LIMIT 1
        """,
        (device_id,),
    )
    row = cur.fetchone()
    cur.execute(
        "SELECT COALESCE(NULLIF(trim(device_version), ''), '') FROM devices WHERE id = %s::uuid",
        (device_id,),
    )
    drow = cur.fetchone()
    dev_lbl = (drow[0] or "").strip() if drow else ""

    base = dev_lbl or "1"
    if row:
        disp = (row[0] or "").strip()
        vl = (row[1] or "").strip()
        for cand in (disp, vl):
            if cand and not cand.lower().startswith("det-"):
                base = cand
                break
    if base.lower().startswith("det-") or len(base) > 48:
        base = dev_lbl if dev_lbl and not dev_lbl.lower().startswith("det-") else "1"
    return _bump_monotonic_label(base)[:64]


def _parse_dt(raw: str | None) -> datetime:
    if isinstance(raw, str) and raw.strip():
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _ensure_detection_event_row(
    cur,
    *,
    event_id: str,
    customer_id: str,
    site_id: str,
    device_id: str,
    endpoint_id: str,
    resolved_device_id: str | None,
    fingerprint: str,
    value_snapshot: dict[str, Any],
    raw_object_id: str | None,
    detected_at: datetime,
) -> None:
    ro = None
    if raw_object_id:
        try:
            ro = str(uuid.UUID(str(raw_object_id).strip()))
        except ValueError:
            ro = None
    fp = (fingerprint or "")[:128]
    cur.execute(
        """
        INSERT INTO version_detection_events (
            id, customer_id, site_id, device_id, endpoint_id, resolved_device_id,
            fingerprint, value_snapshot, raw_object_id, detected_at
        ) VALUES (
            %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
            %s, %s, %s, %s
        )
        ON CONFLICT (id) DO NOTHING
        """,
        (
            event_id,
            customer_id,
            site_id,
            device_id,
            endpoint_id,
            resolved_device_id,
            fp,
            Json(value_snapshot),
            ro,
            detected_at,
        ),
    )


def _process_after_event_row(
    cur,
    *,
    event_id: str,
    device_id: str,
    endpoint_id: str,
    fingerprint: str,
    value_snapshot: dict[str, Any] | None,
    detected_at: datetime,
    existing_rdev: str | None,
) -> tuple[str | None, str]:
    """Returns (resolved_device_id_used, device_version_id inserted or existing)."""
    cur.execute(
        """
        SELECT device_id::text, endpoint_id::text, fingerprint, value_snapshot, detected_at,
               resolved_device_id::text
        FROM version_detection_events
        WHERE id = %s::uuid
        LIMIT 1
        """,
        (event_id,),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("version_detection_events row missing after upsert")
    (
        _device_id,
        _endpoint_id,
        fingerprint_db,
        value_snapshot_db,
        detected_at_db,
        existing_rdev_db,
    ) = row
    snap = value_snapshot_db if isinstance(value_snapshot_db, dict) else (value_snapshot or {})
    fp_use = str(fingerprint_db or fingerprint or "")
    dt_use = detected_at_db or detected_at

    cur.execute(
        """
        SELECT id::text, resolved_device_id::text
        FROM device_versions
        WHERE created_from_detection_event_id = %s::uuid
        LIMIT 1
        """,
        (event_id,),
    )
    existing_dv = cur.fetchone()

    rdev = (existing_rdev_db or existing_rdev or "").strip() or _resolve_resolved_device_id(
        cur, device_id=device_id, endpoint_id=endpoint_id
    )

    if existing_dv:
        dv_id, dv_rdev = existing_dv[0], (existing_dv[1] or "").strip()
        if rdev and not dv_rdev:
            now = datetime.now(timezone.utc)
            cur.execute(
                """
                UPDATE device_versions
                SET resolved_device_id = %s::uuid
                WHERE id = %s::uuid AND resolved_device_id IS NULL
                """,
                (rdev, dv_id),
            )
            cur.execute(
                """
                UPDATE version_detection_events
                SET resolved_device_id = %s::uuid
                WHERE id = %s::uuid AND resolved_device_id IS NULL
                """,
                (rdev, event_id),
            )
            sw = _software_version_hint(snap if isinstance(snap, dict) else None)
            observed = (dt_use or now).isoformat()
            vi: dict[str, Any] = {
                "fingerprint": str(fp_use or ""),
                "changed": True,
                "pending_validation": True,
                "observed_at": observed,
                "detection_event_id": str(event_id),
            }
            if sw:
                vi["software_version"] = sw
            if isinstance(snap, dict):
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
                (Json(patch), now, rdev),
            )
        return rdev, dv_id

    sw = _software_version_hint(snap if isinstance(snap, dict) else None)
    now = datetime.now(timezone.utc)
    vlabel = _version_label_for_fingerprint(str(fp_use or ""))
    friendly = _next_friendly_display(cur, device_id=device_id)
    dv_id = str(uuid.uuid4())

    cur.execute(
        """
        INSERT INTO device_versions (
            id, device_id, version_label, system_version_key, display_version_label,
            resolved_device_id, previous_device_version_id,
            created_from_detection_event_id,
            firmware_version, hardware_version, config_version, endpoint_version, scrubber_version,
            schema_version, manifest_hash, identity_fingerprint, software_version,
            version_source, firmware_channel, status,
            created_at, created_by, activated_at, deprecated_at,
            routing_lane, compatibility
        ) VALUES (
            %s::uuid, %s::uuid, %s, %s, %s,
            %s::uuid, NULL,
            %s::uuid,
            NULL, NULL, NULL, NULL, NULL,
            NULL, NULL, %s, %s,
            'endpoint_version_identity', 'stable', 'detected',
            %s, NULL, NULL, NULL,
            'shared', NULL
        )
        """,
        (
            dv_id,
            device_id,
            vlabel,
            vlabel,
            friendly,
            rdev,
            event_id,
            str(fp_use)[:128] if fp_use else None,
            sw,
            dt_use or now,
        ),
    )

    if rdev:
        cur.execute(
            """
            UPDATE version_detection_events
            SET resolved_device_id = %s::uuid
            WHERE id = %s::uuid AND resolved_device_id IS NULL
            """,
            (rdev, event_id),
        )

        observed = (dt_use or now).isoformat()
        vi: dict[str, Any] = {
            "fingerprint": str(fp_use or ""),
            "changed": True,
            "pending_validation": True,
            "observed_at": observed,
            "detection_event_id": str(event_id),
        }
        if sw:
            vi["software_version"] = sw
        if isinstance(snap, dict):
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
            (Json(patch), now, rdev),
        )

    return rdev, dv_id


def process_version_identity_message(data: dict[str, Any]) -> None:
    if data.get("kind") not in (None, "version_identity_changed"):
        return
    if not _truthy("VERSION_IDENTITY_CONSUMER_ENABLED", "false"):
        return

    event_id = str(data.get("event_id") or "").strip()
    if not event_id:
        log.warning("version_identity_consumer skip: missing event_id")
        return

    inline = bool(data.get("inline_detection_v2"))
    snap_inline = data.get("value_snapshot")
    if inline and isinstance(snap_inline, dict):
        try:
            ev_uuid = uuid.UUID(event_id)
            cust = str(data.get("customer_id") or "").strip()
            site = str(data.get("site_id") or "").strip()
            dev = str(data.get("device_id") or "").strip()
            ept = str(data.get("endpoint_id") or "").strip()
            fp = str(data.get("fingerprint") or "").strip()
            if not cust or not site or not dev or not ept or not fp:
                log.warning("version_identity_consumer inline skip: missing ids")
                return
            rdev_in = str(data.get("resolved_device_id") or "").strip() or None
            raw_oid = str(data.get("raw_object_id") or "").strip() or None
            dt = _parse_dt(str(data.get("detected_at") or data.get("observed_at") or ""))
        except ValueError:
            log.warning("version_identity_consumer inline skip: invalid uuid event_id=%r", event_id)
            return

        conn = psycopg2.connect(db_url())
        try:
            conn.autocommit = False
            with conn.cursor() as cur:
                _ensure_detection_event_row(
                    cur,
                    event_id=str(ev_uuid),
                    customer_id=cust,
                    site_id=site,
                    device_id=dev,
                    endpoint_id=ept,
                    resolved_device_id=rdev_in,
                    fingerprint=fp,
                    value_snapshot=snap_inline,
                    raw_object_id=raw_oid,
                    detected_at=dt,
                )
                rdev, dv_id = _process_after_event_row(
                    cur,
                    event_id=str(ev_uuid),
                    device_id=dev,
                    endpoint_id=ept,
                    fingerprint=fp,
                    value_snapshot=snap_inline,
                    detected_at=dt,
                    existing_rdev=rdev_in,
                )
            conn.commit()
            log.info(
                "version_identity_consumer inline event_id=%s device_version_id=%s resolved_device_id=%s",
                event_id,
                dv_id,
                rdev,
            )
        except Exception:
            conn.rollback()
            log.exception("version_identity_consumer inline failed event_id=%s", event_id)
        finally:
            conn.close()
        return

    try:
        ev_uuid = uuid.UUID(event_id)
    except ValueError:
        log.warning("version_identity_consumer skip: invalid event_id=%r", event_id)
        return

    conn = psycopg2.connect(db_url())
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT device_id::text, endpoint_id::text, fingerprint, value_snapshot, detected_at,
                       resolved_device_id::text
                FROM version_detection_events
                WHERE id = %s::uuid
                LIMIT 1
                """,
                (str(ev_uuid),),
            )
            row = cur.fetchone()
            if not row:
                log.warning("version_identity_consumer skip: unknown event_id=%s", event_id)
                conn.rollback()
                return
            (
                device_id,
                endpoint_id,
                fingerprint,
                value_snapshot,
                detected_at,
                existing_rdev,
            ) = row
            if not device_id or not endpoint_id:
                log.warning("version_identity_consumer skip: event missing device/endpoint event_id=%s", event_id)
                conn.rollback()
                return

            rdev, dv_id = _process_after_event_row(
                cur,
                event_id=str(ev_uuid),
                device_id=device_id,
                endpoint_id=endpoint_id,
                fingerprint=str(fingerprint or ""),
                value_snapshot=value_snapshot if isinstance(value_snapshot, dict) else None,
                detected_at=detected_at or datetime.now(timezone.utc),
                existing_rdev=existing_rdev,
            )
        conn.commit()
        log.info(
            "version_identity_consumer applied event_id=%s device_version_id=%s resolved_device_id=%s",
            event_id,
            dv_id,
            rdev,
        )
    except Exception:
        conn.rollback()
        log.exception("version_identity_consumer failed event_id=%s", event_id)
    finally:
        conn.close()


def main() -> None:
    if not _truthy("VERSION_IDENTITY_CONSUMER_ENABLED", "false"):
        log.warning("VERSION_IDENTITY_CONSUMER_ENABLED is not true — exiting")
        return

    servers = bootstrap_servers()
    consumer = KafkaConsumer(
        _topic(),
        bootstrap_servers=servers,
        group_id=_group_id(),
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: b,
    )
    emit(
        log,
        component="worker-version-identity",
        action="subscriber_started",
        status="ok",
        topic=_topic(),
        group_id=_group_id(),
    )
    log.info("worker-version-identity listening on %s", _topic())
    start_worker_heartbeat("worker-version-identity")
    for msg in consumer:
        vb = len(msg.value) if msg.value else 0
        emit(
            log,
            component="worker-version-identity",
            action="payload_received",
            status="ok",
            topic=msg.topic,
            partition=msg.partition,
            offset=msg.offset,
            value_bytes=vb,
        )
        if not msg.value:
            continue
        try:
            raw = json.loads(msg.value.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            log.warning("version_identity_consumer invalid json: %s", e)
            continue
        if not isinstance(raw, dict):
            continue
        try:
            process_version_identity_message(raw)
        except Exception:
            log.exception("version_identity_consumer process failed")


if __name__ == "__main__":
    main()
