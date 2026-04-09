"""Postgres metadata access for worker-scrubber."""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any

import psycopg2
from psycopg2.extras import Json

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
    oid = str(uuid.uuid4())
    sql = """
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
    raw_uuid = raw_data_object_id if raw_data_object_id else None
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql,
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
        conn.commit()
    finally:
        conn.close()
    return oid
