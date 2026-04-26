"""Write v2 identity/read-model rows after successful scrubber transform."""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import Json

from app.db_url import db_url
from app.primary_device_key import build_device_label, compute_primary_key_hash, extract_primary_key_json
from app.scrubber_engine import ScrubberRunResult

log = logging.getLogger(__name__)


def _truthy(name: str, default: str = "true") -> bool:
    return os.environ.get(name, default).lower() in ("1", "true", "yes")


def _list_of_str(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        s = str(item).strip()
        if s:
            out.append(s)
    return out


def try_write_v2_from_scrubber(
    *,
    device_id: str,
    customer_id: str,
    site_id: str,
    raw_object_id: str,
    result: ScrubberRunResult,
    scrubber_envelope: dict[str, Any] | None,
) -> None:
    if not _truthy("V2_RESOLUTION_WRITE", "true"):
        return
    env_endpoint = (scrubber_envelope or {}).get("endpoint_id")
    if not env_endpoint:
        log.warning("v2_resolution skip: missing endpoint_id raw_object_id=%s", raw_object_id)
        return
    try:
        endpoint_id = str(uuid.UUID(str(env_endpoint)))
    except ValueError:
        log.warning("v2_resolution skip: invalid endpoint_id=%r", env_endpoint)
        return

    payload = result.payload if isinstance(result.payload, dict) else {}
    conn = psycopg2.connect(db_url())
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, customer_id::text, site_id::text, object_name,
                       primary_device_key_fields, device_label_fields
                FROM endpoints
                WHERE id = %s::uuid
                  AND enabled = true
                LIMIT 1
                """,
                (endpoint_id,),
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                log.warning("v2_resolution skip: endpoint not found/disabled endpoint_id=%s", endpoint_id)
                return
            ep_id, ep_customer, ep_site, ep_object_name, pk_fields_raw, label_fields_raw = row
            if ep_customer != customer_id or ep_site != site_id:
                conn.rollback()
                log.warning(
                    "v2_resolution skip: endpoint/customer/site mismatch endpoint_id=%s envelope=(%s,%s) endpoint=(%s,%s)",
                    endpoint_id,
                    customer_id,
                    site_id,
                    ep_customer,
                    ep_site,
                )
                return
            if str(ep_object_name) != str(result.object_name):
                conn.rollback()
                log.warning(
                    "v2_resolution skip: object_name mismatch endpoint_id=%s endpoint=%s result=%s",
                    endpoint_id,
                    ep_object_name,
                    result.object_name,
                )
                return

            pk_fields = _list_of_str(pk_fields_raw)
            if not pk_fields:
                conn.rollback()
                log.warning("v2_resolution skip: no primary_device_key_fields endpoint_id=%s", endpoint_id)
                return
            pk_json = extract_primary_key_json(payload, pk_fields)
            if not pk_json:
                conn.rollback()
                log.warning("v2_resolution skip: primary key extraction failed endpoint_id=%s", endpoint_id)
                return
            pk_hash = compute_primary_key_hash(pk_json)
            label = build_device_label(payload, _list_of_str(label_fields_raw))

            now = datetime.now(timezone.utc)
            cur.execute(
                """
                INSERT INTO resolved_devices (
                  id, customer_id, site_id, endpoint_id, object_name,
                  primary_key_hash, primary_key_json, device_label, device_type, last_seen_at,
                  lifecycle_status, health_status, created_at, updated_at
                ) VALUES (
                  %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
                  %s, %s, %s, %s, %s,
                  %s, %s, %s, %s
                )
                ON CONFLICT ON CONSTRAINT uq_resolved_devices_identity
                DO UPDATE SET
                  device_label = EXCLUDED.device_label,
                  last_seen_at = EXCLUDED.last_seen_at,
                  lifecycle_status = EXCLUDED.lifecycle_status,
                  health_status = EXCLUDED.health_status,
                  updated_at = EXCLUDED.updated_at
                RETURNING id::text
                """,
                (
                    str(uuid.uuid4()),
                    customer_id,
                    site_id,
                    endpoint_id,
                    result.object_name,
                    pk_hash,
                    Json(pk_json),
                    label,
                    None,
                    now,
                    "active",
                    result.health_status,
                    now,
                    now,
                ),
            )
            resolved_device_id = str(cur.fetchone()[0])

            identity_json = pk_json
            display_json = {"device_label": label} if label else {}
            kpi_json = result.kpi if isinstance(result.kpi, dict) else {}
            health_json = {
                "status": result.health_status,
                "code": result.health_code,
                "message": result.health_message,
                "details": result.health_details if isinstance(result.health_details, dict) else {},
            }
            location_json = payload.get("location_json")
            if not isinstance(location_json, dict):
                gps = payload.get("gps")
                location_json = gps if isinstance(gps, dict) else None
            event_ts = now
            raw_ts = payload.get("ts")
            if isinstance(raw_ts, str) and raw_ts.strip():
                try:
                    event_ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
                except ValueError:
                    pass

            cur.execute(
                """
                INSERT INTO scrubbed_events (
                  id, customer_id, site_id, endpoint_id, resolved_device_id, object_name,
                  event_ts, ingested_at, identity_json, display_json, kpi_json, health_json, location_json,
                  payload_ref, created_at
                ) VALUES (
                  %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
                  %s, %s, %s, %s, %s, %s, %s,
                  %s, %s
                )
                RETURNING id::text
                """,
                (
                    str(uuid.uuid4()),
                    customer_id,
                    site_id,
                    endpoint_id,
                    resolved_device_id,
                    result.object_name,
                    event_ts,
                    now,
                    Json(identity_json),
                    Json(display_json),
                    Json(kpi_json),
                    Json(health_json),
                    Json(location_json) if location_json else None,
                    f"raw:{raw_object_id}",
                    now,
                ),
            )
            se = cur.fetchone()
            scrubbed_event_id_s = str(se[0]) if se else None

            cur.execute(
                """
                INSERT INTO latest_device_state (
                  id, customer_id, site_id, endpoint_id, resolved_device_id, object_name,
                  last_event_ts, last_ingested_at, lifecycle_status, health_status,
                  identity_json, display_json, kpi_json, health_json, location_json,
                  scrubbed_event_id, updated_at
                ) VALUES (
                  %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
                  %s, %s, %s, %s,
                  %s, %s, %s, %s, %s,
                  %s::uuid, %s
                )
                ON CONFLICT ON CONSTRAINT uq_latest_device_state_row
                DO UPDATE SET
                  last_event_ts = EXCLUDED.last_event_ts,
                  last_ingested_at = EXCLUDED.last_ingested_at,
                  lifecycle_status = EXCLUDED.lifecycle_status,
                  health_status = EXCLUDED.health_status,
                  identity_json = EXCLUDED.identity_json,
                  display_json = EXCLUDED.display_json,
                  kpi_json = EXCLUDED.kpi_json,
                  health_json = EXCLUDED.health_json,
                  location_json = EXCLUDED.location_json,
                  scrubbed_event_id = EXCLUDED.scrubbed_event_id,
                  updated_at = EXCLUDED.updated_at
                """,
                (
                    str(uuid.uuid4()),
                    customer_id,
                    site_id,
                    endpoint_id,
                    resolved_device_id,
                    result.object_name,
                    event_ts,
                    now,
                    "active",
                    result.health_status,
                    Json(identity_json),
                    Json(display_json),
                    Json(kpi_json),
                    Json(health_json),
                    Json(location_json) if location_json else None,
                    scrubbed_event_id_s,
                    now,
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        log.exception("v2_resolution write failed raw_object_id=%s endpoint_id=%s", raw_object_id, endpoint_id)
    finally:
        conn.close()

"""After scrubber produces a data_object, optionally write v2 resolved_devices / scrubbed_events / latest_device_state.

Resolution order:
1. ``endpoint_id`` on the scrubber Kafka envelope (from raw ingest), validated against the ingest ``device_id``.
2. Else an ``endpoints`` row with ``platform_device_id`` matching ``device_id`` and ``object_name`` matching scrub output.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import Json

from app.data_object_lifecycle import DATA_COMPILED, DATA_PUBLISHED
from app.db_url import db_url
from app.primary_device_key import build_device_label, compute_primary_key_hash
from app.scrubber_engine import ScrubberRunResult, _parse_raw_payload

log = logging.getLogger(__name__)


def _truthy(name: str, default: str = "true") -> bool:
    return os.environ.get(name, default).lower() in ("1", "true", "yes")


def _coerce_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for x in value:
        if isinstance(x, str) and x.strip():
            out.append(x.strip())
    return out


def try_write_v2_from_scrubber(
    *,
    device_id: str,
    customer_id: str,
    site_id: str,
    raw_object_id: str,
    raw_bytes: bytes,
    content_type: str | None,
    result: ScrubberRunResult,
    data_object_id: str,
    data_lifecycle_status: str,
    scrubber_envelope: dict[str, Any] | None = None,
) -> None:
    if not _truthy("V2_RESOLUTION_WRITE", "true"):
        return
    try:
        raw_payload = _parse_raw_payload(raw_bytes, content_type, None)
    except Exception:
        log.debug("v2_resolution raw parse skipped", exc_info=True)
        return
    if not isinstance(raw_payload, dict):
        return

    conn = psycopg2.connect(db_url())
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            row = None
            env_ep = (scrubber_envelope or {}).get("endpoint_id")
            if env_ep:
                cur.execute(
                    """
                    SELECT e.id::text, e.customer_id::text, e.site_id::text, e.object_name,
                           e.primary_device_key_fields, e.device_label_fields, e.device_type,
                           e.lowercase_primary_keys
                    FROM endpoints e
                    LEFT JOIN device_endpoints de ON de.id = e.device_endpoint_id
                    WHERE e.id = %s::uuid
                      AND e.enabled = true
                      AND e.object_name = %s
                      AND (
                        e.platform_device_id = %s::uuid
                        OR (de.id IS NOT NULL AND de.device_id = %s::uuid)
                      )
                    LIMIT 1
                    """,
                    (str(env_ep), result.object_name, device_id, device_id),
                )
                row = cur.fetchone()
            if not row:
                cur.execute(
                    """
                    SELECT id::text, customer_id::text, site_id::text, object_name,
                           primary_device_key_fields, device_label_fields, device_type,
                           lowercase_primary_keys
                    FROM endpoints
                    WHERE platform_device_id = %s::uuid
                      AND object_name = %s
                      AND enabled = true
                    LIMIT 1
                    """,
                    (device_id, result.object_name),
                )
                row = cur.fetchone()
            if not row:
                conn.rollback()
                return
            (
                endpoint_id,
                ep_customer_id,
                ep_site_id,
                object_name,
                pk_fields_raw,
                label_fields_raw,
                device_type,
                lowercase_pk,
            ) = row
            pk_fields = _coerce_str_list(pk_fields_raw)
            label_fields = _coerce_str_list(label_fields_raw)
            if not pk_fields:
                log.debug(
                    "v2_resolution skip endpoint_id=%s no primary_device_key_fields",
                    endpoint_id,
                )
                conn.rollback()
                return
            if ep_customer_id != customer_id or ep_site_id != site_id:
                log.warning(
                    "v2_resolution endpoint tenant mismatch endpoint_id=%s device_id=%s",
                    endpoint_id,
                    device_id,
                )
                conn.rollback()
                return

            try:
                pk_json, pk_hash = compute_primary_key_hash(
                    primary_device_key_fields=pk_fields,
                    payload=raw_payload,
                    lowercase_primary_keys=bool(lowercase_pk),
                )
            except ValueError as e:
                log.warning(
                    "v2_resolution pk extract failed endpoint_id=%s raw_object_id=%s err=%s",
                    endpoint_id,
                    raw_object_id,
                    e,
                )
                conn.rollback()
                return

            label = build_device_label(
                payload=raw_payload,
                device_label_fields=label_fields,
                lowercase_primary_keys=bool(lowercase_pk),
            )
            resolved_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc)
            cur.execute(
                """
                INSERT INTO resolved_devices (
                    id, customer_id, site_id, endpoint_id, object_name,
                    primary_key_hash, primary_key_json, device_label, device_type,
                    last_seen_at, status, created_at, updated_at
                ) VALUES (
                    %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
                    %s, %s, %s, %s,
                    %s, %s, NOW(), NOW()
                )
                ON CONFLICT (customer_id, site_id, endpoint_id, object_name, primary_key_hash)
                DO UPDATE SET
                    last_seen_at = EXCLUDED.last_seen_at,
                    device_label = COALESCE(EXCLUDED.device_label, resolved_devices.device_label),
                    device_type = COALESCE(EXCLUDED.device_type, resolved_devices.device_type),
                    status = EXCLUDED.status,
                    updated_at = NOW()
                RETURNING id::text
                """,
                (
                    resolved_id,
                    customer_id,
                    site_id,
                    endpoint_id,
                    object_name,
                    pk_hash,
                    Json(pk_json),
                    label,
                    device_type,
                    now,
                    "active",
                ),
            )
            rid = cur.fetchone()[0]

            scrub_id = str(uuid.uuid4())
            identity_doc: dict[str, Any] = {"primary_key": pk_json}
            payload_d = result.payload if isinstance(result.payload, dict) else {}
            kpi_d = result.kpi if isinstance(result.kpi, dict) else {}
            health_d = result.health_details if isinstance(result.health_details, dict) else {}
            cur.execute(
                """
                INSERT INTO scrubbed_events (
                    id, customer_id, site_id, endpoint_id, resolved_device_id, object_name,
                    event_ts, identity_json, display_json, kpi_json, health_json, location_json,
                    payload_ref, scrubber_version
                ) VALUES (
                    %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s::uuid, %s
                )
                """,
                (
                    scrub_id,
                    customer_id,
                    site_id,
                    endpoint_id,
                    rid,
                    object_name,
                    now,
                    Json(identity_doc),
                    Json(payload_d),
                    Json(kpi_d),
                    Json(health_d),
                    Json({}),
                    data_object_id,
                    result.scrubber_version,
                ),
            )

            if data_lifecycle_status == DATA_PUBLISHED:
                lifecycle_latest = "published"
            elif data_lifecycle_status == DATA_COMPILED:
                lifecycle_latest = "compiled"
            else:
                lifecycle_latest = (data_lifecycle_status or "unknown")[:32]

            cur.execute(
                """
                INSERT INTO latest_device_state (
                    id, customer_id, site_id, endpoint_id, resolved_device_id, object_name,
                    last_event_ts, last_ingested_at, lifecycle_status, health_status,
                    identity_json, display_json, kpi_json, health_json, location_json,
                    scrubbed_event_id, updated_at
                ) VALUES (
                    %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s::uuid, NOW()
                )
                ON CONFLICT (customer_id, site_id, endpoint_id, resolved_device_id, object_name)
                DO UPDATE SET
                    last_event_ts = EXCLUDED.last_event_ts,
                    last_ingested_at = EXCLUDED.last_ingested_at,
                    lifecycle_status = EXCLUDED.lifecycle_status,
                    health_status = EXCLUDED.health_status,
                    identity_json = EXCLUDED.identity_json,
                    display_json = EXCLUDED.display_json,
                    kpi_json = EXCLUDED.kpi_json,
                    health_json = EXCLUDED.health_json,
                    location_json = EXCLUDED.location_json,
                    scrubbed_event_id = EXCLUDED.scrubbed_event_id,
                    updated_at = NOW()
                """,
                (
                    str(uuid.uuid4()),
                    customer_id,
                    site_id,
                    endpoint_id,
                    rid,
                    object_name,
                    now,
                    now,
                    lifecycle_latest,
                    (result.health_status or "unknown").lower()[:32],
                    Json(identity_doc),
                    Json(payload_d),
                    Json(kpi_d),
                    Json(health_d),
                    Json({}),
                    scrub_id,
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        log.exception(
            "v2_resolution write failed device_id=%s raw_object_id=%s",
            device_id,
            raw_object_id,
        )
    finally:
        conn.close()
