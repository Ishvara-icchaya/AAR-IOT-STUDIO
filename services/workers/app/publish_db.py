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
    return u.replace("postgresql+psycopg2://", "postgresql://")


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
    SELECT id, name, payload, kpi_json, health_status, updated_at
    FROM data_objects
    WHERE id = %s::uuid AND customer_id = %s::uuid
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
