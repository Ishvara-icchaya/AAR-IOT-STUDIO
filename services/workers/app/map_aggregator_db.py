"""Postgres + Timescale access for map object aggregator."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
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


def upsert_trend_metric_bucket(
    *,
    bucket_time: datetime,
    customer_id: str,
    site_id: str,
    scope: str,
    entity_id: str,
    metric_key: str,
    bucket: dict[str, Any],
) -> None:
    """Persist one 5m rollup row to Timescale (same stats as Redis bucket). No-op if TIMESCALE_DATABASE_URL unset."""
    url = _timescale_url()
    if not url or not scope or scope not in ("rdev", "endpoint", "site"):
        return
    n_raw = bucket.get("n", 0)
    try:
        n = int(n_raw)
    except (TypeError, ValueError):
        return
    if n <= 0:
        return
    bt = bucket_time.astimezone(timezone.utc)
    sum_v = float(bucket.get("sum", 0) or 0)
    sumsq_v = float(bucket.get("sumsq", 0) or 0)
    min_v = bucket.get("min")
    max_v = bucket.get("max")
    avg_v = bucket.get("avg")
    std_v = bucket.get("stddev")
    is_partial = bool(bucket.get("is_partial", True))

    def _fnullable(v: Any) -> float | None:
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    min_f = _fnullable(min_v)
    max_f = _fnullable(max_v)
    avg_f = _fnullable(avg_v)
    std_f = _fnullable(std_v)
    if n < 2:
        std_f = None

    sql = """
    INSERT INTO trend_metric_bucket (
        bucket_time, customer_id, site_id, scope, entity_id, metric_key,
        n, sum, sumsq, min, max, avg, stddev, is_partial
    ) VALUES (
        %s::timestamptz, %s::uuid, %s::uuid, %s, %s::uuid, %s,
        %s, %s, %s, %s, %s, %s, %s, %s
    )
    ON CONFLICT (bucket_time, scope, entity_id, metric_key)
    DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        site_id = EXCLUDED.site_id,
        n = EXCLUDED.n,
        sum = EXCLUDED.sum,
        sumsq = EXCLUDED.sumsq,
        min = EXCLUDED.min,
        max = EXCLUDED.max,
        avg = EXCLUDED.avg,
        stddev = EXCLUDED.stddev,
        is_partial = EXCLUDED.is_partial,
        updated_at = now()
    """
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (
                    bt,
                    customer_id,
                    site_id,
                    scope,
                    entity_id,
                    metric_key,
                    n,
                    sum_v,
                    sumsq_v,
                    min_f,
                    max_f,
                    avg_f,
                    std_f,
                    is_partial,
                ),
            )
        conn.commit()
    except Exception:
        log.exception(
            "upsert trend_metric_bucket failed scope=%s entity=%s metric=%s",
            scope,
            entity_id,
            metric_key,
        )
        conn.rollback()
    finally:
        conn.close()


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
    SELECT id, customer_id, site_id, endpoint_id, resolved_device_id, kpi_json, display_json,
           last_event_ts, updated_at
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
                "last_event_ts": row[7],
                "updated_at": row[8],
            }
    finally:
        conn.close()


def fetch_resolved_device_ids_for_endpoint(endpoint_id: str) -> list[str]:
    """All resolved_device PKs for an endpoint (trend endpoint cohort)."""
    sql = "SELECT id::text FROM resolved_devices WHERE endpoint_id = %s::uuid ORDER BY id"
    conn = psycopg2.connect(_metadata_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (endpoint_id,))
            return [str(r[0]) for r in cur.fetchall()]
    finally:
        conn.close()


def fetch_endpoint_ids_for_site(site_id: str) -> list[str]:
    """All endpoint PKs for a site (trend site cohort)."""
    sql = "SELECT id::text FROM endpoints WHERE site_id = %s::uuid ORDER BY id"
    conn = psycopg2.connect(_metadata_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (site_id,))
            return [str(r[0]) for r in cur.fetchall()]
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
