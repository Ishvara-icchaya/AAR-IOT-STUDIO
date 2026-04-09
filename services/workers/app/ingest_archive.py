"""Shared path: JSON payload → MinIO + raw_data_objects + Kafka raw.ingest.

Identity: when a **device_endpoint** is bound (MQTT subscription, WebSocket connection,
REST poller row), that endpoint’s `device_id` is canonical — payload `device_id` /
`site_id` are optional **upstream source metadata** only (see `ingest_metadata`).

Payload-only resolution (`resolve_device_row`) remains for transports with **no**
endpoint binding (e.g. CoAP listener). See ``docs/CANONICAL_DEVICE_IDENTITY_INGEST.md``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.errors as pg_errors
from psycopg2.extras import Json

from app.device_endpoint_lifecycle import record_ingest_failure, touch_after_archived_success
from app.kafka_publish import publish_json
from app.minio_worker import put_raw_object_bytes, remove_raw_object

log = logging.getLogger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

INGEST_ARCHIVED = "archived"
INGEST_PUBLISHED_TO_KAFKA = "published_to_kafka"
VERIFY_NEVER = "never"

# Legacy (pre–multi-protocol); API monitoring falls back if present.
LEGACY_MQTT_BRIDGE_LAST_INGEST_REDIS_KEY = "aar:mqtt_bridge:last_ingest_at"


def last_ingest_redis_key(protocol_source: str) -> str:
    """Per-protocol successful archive timestamp (Unix seconds as string)."""
    seg = {
        "mqtt": "mqtt",
        "coap": "coap",
        "websocket": "websocket",
        "rest_poll": "rest_poller",
    }.get(protocol_source, protocol_source.replace(".", "_")[:64])
    return f"aar:ingress:{seg}:last_ingest_at"


def touch_last_ingest_redis(protocol_source: str) -> None:
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        return
    try:
        import redis
        import time as _t

        r = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        try:
            ts = str(_t.time())
            r.set(last_ingest_redis_key(protocol_source), ts)
            if protocol_source == "mqtt":
                r.set(LEGACY_MQTT_BRIDGE_LAST_INGEST_REDIS_KEY, ts)
        finally:
            try:
                r.close()
            except Exception:
                pass
    except Exception:
        log.debug("last_ingest redis touch failed", exc_info=True)


def db_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    return u.replace("postgresql+psycopg2://", "postgresql://")


def truthy(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).lower() in ("1", "true", "yes")


def max_bytes() -> int:
    raw = os.environ.get("RAW_INGEST_MAX_BYTES", "33554432")
    try:
        return max(1, min(int(raw), 64 * 1024 * 1024))
    except ValueError:
        return 33554432


def bucket() -> str:
    return os.environ.get("MINIO_BUCKET_RAW", "aar-raw")


def kafka_topic_raw() -> str:
    return os.environ.get("KAFKA_RAW_INGEST_TOPIC", "raw.ingest")


def build_ingest_metadata_from_payload(
    payload: dict[str, Any],
    *,
    device_endpoint_id: uuid.UUID | None = None,
) -> dict[str, Any] | None:
    """Map upstream identity fields to metadata; does not interpret them as AAR device/site ids."""
    dev_key = os.environ.get("MQTT_DEVICE_KEY", "device_id")
    site_key = os.environ.get("MQTT_SITE_KEY", "site_id")
    out: dict[str, Any] = {}
    rv = payload.get(dev_key)
    if rv is not None:
        s = str(rv).strip()
        if s:
            out["source_device_id"] = s[:2048]
    rs = payload.get(site_key)
    if rs is not None:
        if isinstance(rs, str) and rs.strip():
            out["source_site_id"] = rs.strip()[:512]
        else:
            t = str(rs).strip()
            if t:
                out["source_site_id"] = t[:512]
    if device_endpoint_id is not None:
        out["device_endpoint_id"] = str(device_endpoint_id)
    return out if out else None


def parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    s = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def resolve_device_row(cur, payload: dict[str, Any]) -> tuple[str, str, str] | None:
    """Returns (device_id, customer_id, site_id) as uuid strings, or None."""
    dev_key = os.environ.get("MQTT_DEVICE_KEY", "device_id")
    site_key = os.environ.get("MQTT_SITE_KEY", "site_id")
    raw_dev = payload.get(dev_key)
    if raw_dev is None:
        log.error("ingest_archive missing device field %r (unbound ingest)", dev_key)
        return None
    dev_s = str(raw_dev).strip()
    if not dev_s:
        log.error("ingest_archive empty device field %r (unbound ingest)", dev_key)
        return None

    if _UUID_RE.match(dev_s):
        cur.execute(
            """
            SELECT d.id::text, d.customer_id::text, d.site_id::text, d.is_active
            FROM devices d
            WHERE d.id = %s::uuid
            """,
            (dev_s,),
        )
        row = cur.fetchone()
        if not row:
            log.error("ingest_archive no device for uuid %s", dev_s)
            return None
        did, cid, sid, active = row[0], row[1], row[2], row[3]
        if not active:
            log.error("ingest_archive device inactive id=%s", did)
            return None
        return did, cid, sid

    site_slug = payload.get(site_key)
    if isinstance(site_slug, str) and site_slug.strip():
        cur.execute(
            """
            SELECT d.id::text, d.customer_id::text, d.site_id::text, d.is_active
            FROM devices d
            INNER JOIN sites s ON s.id = d.site_id
            WHERE d.name = %s AND s.name = %s
            """,
            (dev_s, site_slug.strip()),
        )
        rows = cur.fetchall()
        if len(rows) == 0:
            log.error(
                "ingest_archive no device for name=%r site=%r — register a device with this name under this site, "
                "or use a saved MQTT endpoint so identity comes from the endpoint (not the payload)",
                dev_s,
                site_slug.strip(),
            )
            return None
        if len(rows) > 1:
            log.error(
                "ingest_archive ambiguous device name=%r site=%r matches=%s",
                dev_s,
                site_slug.strip(),
                len(rows),
            )
            return None
        did, cid, sid, active = rows[0][0], rows[0][1], rows[0][2], rows[0][3]
        if not active:
            log.error("ingest_archive device inactive id=%s", did)
            return None
        return did, cid, sid

    cur.execute(
        """
        SELECT d.id::text, d.customer_id::text, d.site_id::text, d.is_active
        FROM devices d
        WHERE d.name = %s
        """,
        (dev_s,),
    )
    rows = cur.fetchall()
    if len(rows) == 0:
        log.error(
            "ingest_archive no device for name=%r (no site in payload) — add %r or register the device name",
            dev_s,
            site_key,
        )
        return None
    if len(rows) > 1:
        log.error(
            "ingest_archive ambiguous device name=%r matches=%s; include %r in payload",
            dev_s,
            len(rows),
            site_key,
        )
        return None
    did, cid, sid, active = rows[0][0], rows[0][1], rows[0][2], rows[0][3]
    if not active:
        log.error("ingest_archive device inactive id=%s", did)
        return None
    return did, cid, sid


def storage_key(
    *,
    customer_id: uuid.UUID,
    device_id: uuid.UUID,
    raw_id: uuid.UUID,
    ingested_at: datetime,
    suffix: str,
) -> str:
    return (
        f"{customer_id}/{device_id}/"
        f"{ingested_at:%Y}/{ingested_at:%m}/{ingested_at:%d}/{raw_id}{suffix}"
    )


def _persist_core(
    *,
    payload: dict[str, Any],
    body: bytes,
    device_id: uuid.UUID,
    customer_id: uuid.UUID,
    protocol_source: str,
    ingest_metadata: dict[str, Any] | None = None,
) -> bool:
    if len(body) > max_bytes():
        log.warning("ingest_archive payload too large bytes=%s", len(body))
        return False

    ingested_at = datetime.now(timezone.utc)
    raw_id = uuid.uuid4()
    captured_at = parse_ts(payload.get("ts"))
    trace_id = payload.get("run_id")
    trace_s = str(trace_id).strip()[:128] if trace_id is not None else None

    storage_key_s = storage_key(
        customer_id=customer_id,
        device_id=device_id,
        raw_id=raw_id,
        ingested_at=ingested_at,
        suffix=".json",
    )
    checksum = hashlib.sha256(body).hexdigest()
    ct = "application/json"
    bkt = bucket()

    try:
        put_raw_object_bytes(
            bucket=bkt, key=storage_key_s, data=body, content_type=ct
        )
    except Exception:
        log.exception("ingest_archive minio put failed key=%s", storage_key_s)
        try:
            conn_e = psycopg2.connect(db_url())
            try:
                with conn_e.cursor() as ec:
                    record_ingest_failure(ec, device_id, protocol_source, "MinIO put failed")
                conn_e.commit()
            finally:
                conn_e.close()
        except Exception:
            log.debug("endpoint lifecycle minio failure record skipped", exc_info=True)
        return False

    _insert_row_base = (
        str(raw_id),
        str(customer_id),
        str(device_id),
        storage_key_s,
        ct,
        len(body),
        captured_at,
        ingested_at,
        checksum,
        INGEST_ARCHIVED,
        VERIFY_NEVER,
        protocol_source,
    )

    conn = psycopg2.connect(db_url())
    try:
        with conn.cursor() as cur:
            try:
                try:
                    cur.execute(
                        """
                        INSERT INTO raw_data_objects (
                          id, customer_id, device_id, storage_key, content_type, size_bytes,
                          captured_at, ingested_at, checksum, ingest_status, verify_status,
                          protocol_source, ingest_metadata
                        ) VALUES (
                          %s::uuid, %s::uuid, %s::uuid, %s, %s, %s,
                          %s, %s, %s, %s, %s, %s, %s
                        )
                        """,
                        (
                            *_insert_row_base,
                            Json(ingest_metadata) if ingest_metadata else None,
                        ),
                    )
                except pg_errors.UndefinedColumn as ue:
                    if "ingest_metadata" not in str(ue).lower():
                        raise
                    conn.rollback()
                    log.warning(
                    "ingest_archive column ingest_metadata missing — run `alembic upgrade head` on the API DB. "
                    "Archiving without DB metadata until then.",
                    )
                    cur.execute(
                        """
                        INSERT INTO raw_data_objects (
                          id, customer_id, device_id, storage_key, content_type, size_bytes,
                          captured_at, ingested_at, checksum, ingest_status, verify_status,
                          protocol_source
                        ) VALUES (
                          %s::uuid, %s::uuid, %s::uuid, %s, %s, %s,
                          %s, %s, %s, %s, %s, %s
                        )
                        """,
                        _insert_row_base,
                    )
                conn.commit()
                touch_last_ingest_redis(protocol_source)
                touch_after_archived_success(cur, device_id, protocol_source)
                conn.commit()
            except Exception:
                conn.rollback()
                log.exception("ingest_archive db insert failed raw_id=%s", raw_id)
                try:
                    with conn.cursor() as ec:
                        record_ingest_failure(ec, device_id, protocol_source, "database insert failed")
                    conn.commit()
                except Exception:
                    log.debug("endpoint lifecycle db failure record skipped", exc_info=True)
                try:
                    remove_raw_object(bucket=bkt, key=storage_key_s)
                except Exception:
                    log.exception("ingest_archive minio cleanup failed key=%s", storage_key_s)
                return False
    finally:
        conn.close()

    kafka_ok = truthy("KAFKA_PUBLISH_RAW_INGEST", "true")
    if not kafka_ok:
        log.debug("ingest_archive kafka publish disabled raw_id=%s", raw_id)
        return True

    envelope: dict[str, Any] = {
        "schema_version": "1",
        "raw_object_id": str(raw_id),
        "customer_id": str(customer_id),
        "device_id": str(device_id),
        "storage_key": storage_key_s,
        "content_type": ct,
        "size_bytes": len(body),
        "checksum_sha256": checksum,
        "ingested_at": ingested_at.isoformat().replace("+00:00", "Z"),
        "source": protocol_source,
        "protocol_id": protocol_source,
    }
    if captured_at is not None:
        envelope["captured_at"] = captured_at.isoformat().replace("+00:00", "Z")
    if trace_s:
        envelope["trace_id"] = trace_s
    if ingest_metadata:
        envelope["ingest_metadata"] = ingest_metadata

    try:
        publish_json(
            topic=kafka_topic_raw(),
            key=str(device_id),
            payload=envelope,
        )
    except Exception:
        log.exception(
            "ingest_archive kafka publish failed raw_id=%s (MinIO + Postgres row may still exist; UI list may show it)",
            raw_id,
        )
        return False

    conn2 = psycopg2.connect(db_url())
    try:
        with conn2.cursor() as cur:
            cur.execute(
                """
                UPDATE raw_data_objects SET ingest_status = %s WHERE id = %s::uuid
                """,
                (INGEST_PUBLISHED_TO_KAFKA, str(raw_id)),
            )
        conn2.commit()
    except Exception:
        conn2.rollback()
        log.exception("ingest_archive db status update failed raw_id=%s", raw_id)
    finally:
        conn2.close()

    log.info(
        "ingest_archive ingested raw_object_id=%s device_id=%s protocol=%s bytes=%s",
        raw_id,
        device_id,
        protocol_source,
        len(body),
    )
    return True


def ingest_json_payload(
    payload: dict[str, Any],
    body: bytes,
    *,
    protocol_source: str,
) -> bool:
    conn = psycopg2.connect(db_url())
    try:
        with conn.cursor() as cur:
            resolved = resolve_device_row(cur, payload)
            if not resolved:
                return False
            device_id_s, customer_id_s, _site_id_s = resolved
            device_id = uuid.UUID(device_id_s)
            customer_id = uuid.UUID(customer_id_s)
    finally:
        conn.close()

    meta = build_ingest_metadata_from_payload(payload, device_endpoint_id=None)
    return _persist_core(
        payload=payload,
        body=body,
        device_id=device_id,
        customer_id=customer_id,
        protocol_source=protocol_source,
        ingest_metadata=meta,
    )


def ingest_json_payload_for_endpoint(
    payload: dict[str, Any],
    body: bytes,
    *,
    device_endpoint_id: uuid.UUID,
    protocol_source: str,
) -> bool:
    """Archive using the device bound to ``device_endpoints.id`` (MQTT and other endpoint-driven ingest)."""
    conn = psycopg2.connect(db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT de.device_id::text, d.customer_id::text, d.is_active, de.is_active
                FROM device_endpoints de
                INNER JOIN devices d ON d.id = de.device_id
                WHERE de.id = %s::uuid
                """,
                (str(device_endpoint_id),),
            )
            row = cur.fetchone()
            if not row:
                log.error("ingest_archive no device_endpoint id=%s", device_endpoint_id)
                return False
            device_id_s, customer_id_s, d_active, e_active = row[0], row[1], row[2], row[3]
            if not e_active:
                log.error("ingest_archive endpoint inactive id=%s", device_endpoint_id)
                return False
            if not d_active:
                log.error("ingest_archive device inactive id=%s", device_id_s)
                return False
            device_id = uuid.UUID(device_id_s)
            customer_id = uuid.UUID(customer_id_s)
    finally:
        conn.close()

    meta = build_ingest_metadata_from_payload(
        payload, device_endpoint_id=device_endpoint_id
    )
    return _persist_core(
        payload=payload,
        body=body,
        device_id=device_id,
        customer_id=customer_id,
        protocol_source=protocol_source,
        ingest_metadata=meta,
    )


def ingest_json_payload_for_device(
    payload: dict[str, Any],
    body: bytes,
    *,
    device_id: uuid.UUID,
    protocol_source: str,
    device_endpoint_id: uuid.UUID | None = None,
) -> bool:
    conn = psycopg2.connect(db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.customer_id::text, d.is_active
                FROM devices d
                WHERE d.id = %s::uuid
                """,
                (str(device_id),),
            )
            row = cur.fetchone()
            if not row:
                log.warning("ingest_archive no device row id=%s", device_id)
                return False
            customer_id_s, active = row[0], row[1]
            if not active:
                log.warning("ingest_archive device inactive id=%s", device_id)
                return False
            customer_id = uuid.UUID(customer_id_s)
    finally:
        conn.close()

    meta = build_ingest_metadata_from_payload(payload, device_endpoint_id=device_endpoint_id)
    return _persist_core(
        payload=payload,
        body=body,
        device_id=device_id,
        customer_id=customer_id,
        protocol_source=protocol_source,
        ingest_metadata=meta,
    )
