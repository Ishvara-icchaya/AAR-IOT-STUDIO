"""Postgres helpers for worker-publish."""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
log = logging.getLogger(__name__)


def _db_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    u = u.replace("postgresql+psycopg2://", "postgresql://").strip()
    if not u:
        raise RuntimeError(
            "METADATA_DATABASE_URL or DATABASE_URL must be set "
            "(e.g. postgresql://user:pass@postgres:5432/aar_metadata for Docker Compose)"
        )
    return u


def fetch_active_services(
    conn,
    *,
    customer_id: str,
    source_type: str,
    source_object_id: str,
) -> list[dict[str, Any]]:
    sql = """
    SELECT id, customer_id, site_id, publish_protocol, target_config_json, name
    FROM published_services
    WHERE customer_id = %s::uuid
      AND source_type = %s
      AND source_object_id = %s::uuid
      AND status = 'active'
    """
    with conn.cursor() as cur:
        cur.execute(sql, (customer_id, source_type, source_object_id))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_data_object_payload(conn, *, customer_id: str, data_object_id: str) -> dict[str, Any] | None:
    sql = """
    SELECT d.id, d.name, d.payload, d.kpi_json, d.health_status, d.updated_at
    FROM data_objects d
    INNER JOIN devices dev ON dev.id = d.device_id
    INNER JOIN sites s ON s.id = d.site_id
    INNER JOIN customers cust ON cust.id = d.customer_id
    WHERE d.id = %s::uuid AND d.customer_id = %s::uuid
      AND d.lifecycle_status = 'published'
      AND dev.operational_status = 'active'
      AND s.operational_status = 'active'
      AND cust.operational_status = 'active'
    """
    with conn.cursor() as cur:
        cur.execute(sql, (data_object_id, customer_id))
        row = cur.fetchone()
        if not row:
            return None
        return {
            "source_type": "data_object",
            "data_object_id": str(row[0]),
            "name": row[1],
            "payload": row[2] if isinstance(row[2], dict) else {},
            "kpi_json": row[3] if isinstance(row[3], dict) else {},
            "health_status": row[4],
            "updated_at": row[5].isoformat() if row[5] else None,
        }


def load_result_object_payload(conn, *, customer_id: str, result_object_id: str) -> dict[str, Any] | None:
    sql = """
    SELECT id, result_object_name, workflow_id, payload_json, created_at
    FROM workflow_result_objects
    WHERE id = %s::uuid AND customer_id = %s::uuid
      AND operational_status = 'active'
    """
    with conn.cursor() as cur:
        cur.execute(sql, (result_object_id, customer_id))
        row = cur.fetchone()
        if not row:
            return None
        return {
            "source_type": "result_object",
            "result_object_id": str(row[0]),
            "result_object_name": row[1],
            "workflow_id": str(row[2]),
            "payload": row[3] if isinstance(row[3], dict) else {},
            "created_at": row[4].isoformat() if row[4] else None,
        }


def load_latest_device_state_payload(
    conn,
    *,
    customer_id: str,
    latest_device_state_id: str,
) -> dict[str, Any] | None:
    sql = """
    SELECT l.id, l.endpoint_id, l.resolved_device_id, l.object_name, l.kpi_json, l.health_json, l.location_json,
           l.display_json, l.identity_json, l.updated_at
    FROM latest_device_state l
    INNER JOIN sites s ON s.id = l.site_id
    INNER JOIN customers c ON c.id = l.customer_id
    WHERE l.id = %s::uuid AND l.customer_id = %s::uuid
      AND s.operational_status = 'active'
      AND c.operational_status = 'active'
    """
    with conn.cursor() as cur:
        cur.execute(sql, (latest_device_state_id, customer_id))
        row = cur.fetchone()
        if not row:
            return None
        return {
            "source_type": "latest_device_state",
            "latest_device_state_id": str(row[0]),
            "endpoint_id": str(row[1]),
            "resolved_device_id": str(row[2]),
            "object_name": row[3],
            "kpi_json": row[4] if isinstance(row[4], dict) else {},
            "health_json": row[5] if isinstance(row[5], dict) else {},
            "location_json": row[6] if isinstance(row[6], dict) else {},
            "display_json": row[7] if isinstance(row[7], dict) else {},
            "identity_json": row[8] if isinstance(row[8], dict) else {},
            "updated_at": row[9].isoformat() if row[9] else None,
        }


def insert_delivery_log(
    conn,
    *,
    published_service_id: str,
    source_event_id: str | None,
    ok: bool,
    response_code: str | None,
    response_message: str | None,
    trace_id: str | None,
) -> None:
    lid = str(uuid.uuid4())
    status = "success" if ok else "failed"
    sql = """
    INSERT INTO published_service_delivery_logs
      (id, published_service_id, source_event_id, status, response_code, response_message, trace_id, published_at)
    VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s, NOW())
    """
    with conn.cursor() as cur:
        cur.execute(
            sql,
            (
                lid,
                published_service_id,
                source_event_id,
                status,
                response_code,
                response_message,
                trace_id,
            ),
        )


def update_service_publish_outcome(
    conn,
    *,
    service_id: str,
    ok: bool,
    error_message: str | None,
) -> None:
    now = datetime.now(timezone.utc)
    if ok:
        sql = """
        UPDATE published_services
        SET last_published_at = %s, last_error_message = NULL, updated_at = NOW()
        WHERE id = %s::uuid
        """
        params = (now, service_id)
    else:
        sql = """
        UPDATE published_services
        SET last_published_at = %s, last_error_message = %s,
            status = CASE WHEN status = 'active' THEN 'failed' ELSE status END,
            updated_at = NOW()
        WHERE id = %s::uuid
        """
        params = (now, error_message, service_id)
    with conn.cursor() as cur:
        cur.execute(sql, params)


def resolve_result_object_tenant(conn, *, result_object_id: str) -> tuple[str | None, str | None]:
    sql = """
    SELECT customer_id::text, site_id::text FROM workflow_result_objects WHERE id = %s::uuid
    """
    with conn.cursor() as cur:
        cur.execute(sql, (result_object_id,))
        row = cur.fetchone()
        if not row:
            return None, None
        return row[0], row[1]
