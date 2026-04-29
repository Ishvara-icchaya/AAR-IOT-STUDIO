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
from app.kafka_publish import publish_json
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
                       primary_device_key_fields, device_label_fields, location_fields,
                       identity_published_at
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
            (
                _ep_id,
                ep_customer,
                ep_site,
                ep_object_name,
                pk_fields_raw,
                label_fields_raw,
                location_fields_raw,
                identity_pub,
            ) = row
            if identity_pub is None:
                conn.rollback()
                log.warning("v2_resolution skip: identity not published endpoint_id=%s", endpoint_id)
                return
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
            object_name = str(ep_object_name)

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
                    object_name,
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
            if not isinstance(location_json, dict):
                if isinstance(location_fields_raw, list) and len(location_fields_raw) >= 2:
                    lat_v = payload.get(str(location_fields_raw[0]))
                    lon_v = payload.get(str(location_fields_raw[1]))
                    try:
                        location_json = {"lat": float(lat_v), "lon": float(lon_v)}
                    except (TypeError, ValueError):
                        location_json = None
                elif isinstance(location_fields_raw, dict):
                    lat_k = location_fields_raw.get("lat") or location_fields_raw.get("latitude")
                    lon_k = location_fields_raw.get("lon") or location_fields_raw.get("longitude")
                    lat_v = payload.get(str(lat_k)) if lat_k else None
                    lon_v = payload.get(str(lon_k)) if lon_k else None
                    try:
                        location_json = {"lat": float(lat_v), "lon": float(lon_v)}
                    except (TypeError, ValueError):
                        location_json = None
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
                    object_name,
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
                RETURNING id::text
                """,
                (
                    str(uuid.uuid4()),
                    customer_id,
                    site_id,
                    endpoint_id,
                    resolved_device_id,
                    object_name,
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
            lds_row = cur.fetchone()
            latest_device_state_id = str(lds_row[0]) if lds_row else None
        conn.commit()
        if scrubbed_event_id_s and latest_device_state_id:
            topic = os.environ.get("KAFKA_LATEST_DEVICE_STATE_TOPIC", "latest_device_state.updated")
            publish_json(
                topic=topic,
                key=str(resolved_device_id),
                payload={
                    "kind": "latest_device_state_updated",
                    "customer_id": customer_id,
                    "site_id": site_id,
                    "endpoint_id": endpoint_id,
                    "resolved_device_id": resolved_device_id,
                    "latest_device_state_id": latest_device_state_id,
                    "scrubbed_event_id": scrubbed_event_id_s,
                },
            )
    except Exception:
        conn.rollback()
        log.exception("v2_resolution write failed raw_object_id=%s endpoint_id=%s", raw_object_id, endpoint_id)
    finally:
        conn.close()
