"""Postgres metadata access for worker-scrubber."""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any

import psycopg2
from psycopg2.extras import Json

from app.tenant_rollup_redis import rollup_incr_site

log = logging.getLogger(__name__)


def _db_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    return u.replace("postgresql+psycopg2://", "postgresql://")


def fetch_site_id_and_scrubber_studio(*, device_id: str) -> tuple[str | None, dict[str, Any] | None]:
    """Returns (site_id uuid str or None, scrubberStudio dict or None)."""
    sql = """
    SELECT d.site_id::text, dobj.mapping
    FROM devices d
    LEFT JOIN device_objects dobj ON dobj.device_id = d.id
    WHERE d.id = %s::uuid
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (device_id,))
            row = cur.fetchone()
            if not row:
                return None, None
            site_id, mapping = row[0], row[1]
            if not isinstance(mapping, dict):
                mapping = {}
            ss = mapping.get("scrubberStudio")
            studio = ss if isinstance(ss, dict) else None
            return site_id, studio
    finally:
        conn.close()


def insert_data_object(
    *,
    customer_id: str,
    site_id: str,
    device_id: str,
    raw_data_object_id: str | None,
    name: str,
    payload: dict[str, Any],
    kpi_json: dict[str, Any],
    health_status: str | None,
    health_code: str | None,
    health_message: str | None,
    scrubber_version: str | None,
    has_gps: bool,
    has_kpi: bool,
    has_health: bool,
    has_timeseries: bool,
    lifecycle_status: str,
    error_message: str | None,
    trace_id: str | None,
) -> str:
    """Insert metadata row on ``data_objects``, one observed row on ``data_object_details``, then set latest pointers.

    Metadata columns remain the compatibility surface for readers; detail holds the same snapshot for history.
    """
    oid = str(uuid.uuid4())
    detail_id = str(uuid.uuid4())
    insert_meta = """
    INSERT INTO data_objects (
      id, customer_id, site_id, device_id, raw_data_object_id, name, payload,
      kpi_json, health_status, health_code, health_message, scrubber_version,
      has_gps, has_kpi, has_health, has_timeseries,
      lifecycle_status, error_message, trace_id, created_at, updated_at
    ) VALUES (
      %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s, %s,
      %s, %s, %s, %s, %s,
      %s, %s, %s, %s,
      %s, %s, %s, NOW(), NOW()
    )
    """
    insert_detail = """
    INSERT INTO data_object_details (
      id, data_object_id, raw_data_object_id, customer_id, site_id, device_id,
      observed_at, payload_json, kpi_json, health_status, health_code, health_message,
      grouping_json, trace_id, created_at
    ) VALUES (
      %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid, %s::uuid,
      NOW(), %s, %s, %s, %s, %s,
      %s, %s, NOW()
    )
    """
    update_latest = """
    UPDATE data_objects
    SET latest_detail_id = %s::uuid, latest_seen_at = NOW()
    WHERE id = %s::uuid
    """
    raw_uuid = raw_data_object_id if raw_data_object_id else None
    grouping: dict[str, Any] = {}
    conn = psycopg2.connect(_db_url())
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                insert_meta,
                (
                    oid,
                    customer_id,
                    site_id,
                    device_id,
                    raw_uuid,
                    name,
                    Json(payload),
                    Json(kpi_json),
                    health_status,
                    health_code,
                    health_message,
                    scrubber_version,
                    has_gps,
                    has_kpi,
                    has_health,
                    has_timeseries,
                    lifecycle_status,
                    error_message,
                    trace_id,
                ),
            )
            cur.execute(
                insert_detail,
                (
                    detail_id,
                    oid,
                    raw_uuid,
                    customer_id,
                    site_id,
                    device_id,
                    Json(payload),
                    Json(kpi_json),
                    health_status,
                    health_code,
                    health_message,
                    Json(grouping),
                    trace_id,
                ),
            )
            cur.execute(update_latest, (detail_id, oid))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    try:
        rollup_incr_site(customer_id=customer_id, site_id=site_id, kind="do")
    except Exception:
        pass
    return oid
