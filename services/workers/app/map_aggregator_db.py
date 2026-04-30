"""Postgres + Timescale access for map object aggregator."""

from __future__ import annotations

import logging
import os
from typing import Any

import psycopg2
from psycopg2.extras import Json

log = logging.getLogger(__name__)


def _metadata_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    return u.replace("postgresql+psycopg2://", "postgresql://")


def _timescale_url() -> str:
    u = os.environ.get("TIMESCALE_DATABASE_URL") or ""
    return u.replace("postgresql+psycopg2://", "postgresql://")


def fetch_data_object_row(data_object_id: str) -> dict[str, Any] | None:
    sql = """
    SELECT id, customer_id, site_id, device_id, name, payload, kpi_json, health_status, health_message,
           has_gps, has_kpi, has_health, lifecycle_status, updated_at
    FROM data_objects WHERE id = %s::uuid
    """
    conn = psycopg2.connect(_metadata_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (data_object_id,))
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": str(row[0]),
                "customer_id": str(row[1]),
                "site_id": str(row[2]),
                "device_id": str(row[3]),
                "name": row[4],
                "payload": row[5] if isinstance(row[5], dict) else {},
                "kpi_json": row[6] if isinstance(row[6], dict) else {},
                "health_status": row[7],
                "health_message": row[8],
                "has_gps": bool(row[9]),
                "has_kpi": bool(row[10]),
                "has_health": bool(row[11]),
                "lifecycle_status": row[12],
                "updated_at": row[13],
            }
    finally:
        conn.close()


def fetch_latest_device_state_row(latest_device_state_id: str) -> dict[str, Any] | None:
    """Latest device state row for trend rollup (resolved_device + KPI payloads)."""
    sql = """
    SELECT id, customer_id, site_id, endpoint_id, resolved_device_id, kpi_json, display_json
    FROM latest_device_state WHERE id = %s::uuid
    """
    conn = psycopg2.connect(_metadata_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (latest_device_state_id,))
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": str(row[0]),
                "customer_id": str(row[1]),
                "site_id": str(row[2]),
                "endpoint_id": str(row[3]),
                "resolved_device_id": str(row[4]),
                "kpi_json": row[5] if isinstance(row[5], dict) else {},
                "display_json": row[6] if isinstance(row[6], dict) else {},
            }
    finally:
        conn.close()


def fetch_result_object_row(result_object_id: str) -> dict[str, Any] | None:
    sql = """
    SELECT id, customer_id, site_id, result_object_name, payload_json, health_status, created_at,
           latest_seen_at
    FROM workflow_result_objects WHERE id = %s::uuid
    """
    conn = psycopg2.connect(_metadata_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (result_object_id,))
            row = cur.fetchone()
            if not row:
                return None
            return {
                "id": str(row[0]),
                "customer_id": str(row[1]),
                "site_id": str(row[2]),
                "result_object_name": row[3],
                "payload_json": row[4] if isinstance(row[4], dict) else {},
                "health_status": row[5],
                "created_at": row[6],
                "latest_seen_at": row[7],
            }
    finally:
        conn.close()


def fetch_device_name(device_id: str) -> str | None:
    sql = "SELECT name FROM devices WHERE id = %s::uuid"
    conn = psycopg2.connect(_metadata_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (device_id,))
            row = cur.fetchone()
            return str(row[0]) if row else None
    finally:
        conn.close()


def fetch_site_name(site_id: str) -> str | None:
    sql = "SELECT name FROM sites WHERE id = %s::uuid"
    conn = psycopg2.connect(_metadata_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (site_id,))
            row = cur.fetchone()
            return str(row[0]) if row else None
    finally:
        conn.close()


def insert_map_kpi_history(
    *,
    time_iso: str,
    customer_id: str,
    object_kind: str,
    object_id: str,
    kpi_key: str,
    value: float | None,
    record: dict[str, Any],
) -> None:
    url = _timescale_url()
    if not url:
        return
    sql = """
    INSERT INTO map_object_kpi_history (time, customer_id, object_kind, object_id, kpi_key, value, record)
    VALUES (%s::timestamptz, %s::uuid, %s, %s::uuid, %s, %s, %s)
    """
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (time_iso, customer_id, object_kind, object_id, kpi_key, value, Json(record)),
            )
        conn.commit()
    except Exception:
        log.exception("insert map_object_kpi_history failed")
        conn.rollback()
    finally:
        conn.close()
