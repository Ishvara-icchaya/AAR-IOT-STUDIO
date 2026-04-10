"""Persist workflow executions and result_objects (metadata DB)."""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import Json

log = logging.getLogger(__name__)


def _db_url() -> str:
    u = os.environ.get("METADATA_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    return u.replace("postgresql+psycopg2://", "postgresql://")


def find_published_workflows_for_data_object(
    *, customer_id: str, site_id: str, data_object_id: str
) -> list[str]:
    sql = """
    SELECT DISTINCT w.id::text
    FROM workflows w
    INNER JOIN workflow_nodes n ON n.workflow_id = w.id
    WHERE w.site_id = %s::uuid
      AND w.customer_id = %s::uuid
      AND w.is_published = true
      AND w.lifecycle_status = 'published'
      AND n.node_type = 'input'
      AND (n.config_json->>'data_object_id') = %s
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (site_id, customer_id, data_object_id))
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def load_workflow_graph(*, workflow_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, node_type, config_json, node_name
                FROM workflow_nodes WHERE workflow_id = %s::uuid
                """,
                (workflow_id,),
            )
            nodes = [
                {"id": r[0], "node_type": r[1], "config_json": r[2] or {}, "node_name": r[3]}
                for r in cur.fetchall()
            ]
            cur.execute(
                """
                SELECT source_node_id::text, target_node_id::text
                FROM workflow_edges WHERE workflow_id = %s::uuid
                """,
                (workflow_id,),
            )
            edges = [
                {"source_node_id": r[0], "target_node_id": r[1]} for r in cur.fetchall()
            ]
        return nodes, edges
    finally:
        conn.close()


def load_data_object_payload(*, data_object_id: str, customer_id: str) -> dict[str, Any] | None:
    sql = """
    SELECT d.payload, d.kpi_json, d.health_status, d.lifecycle_status,
           dev.operational_status, s.operational_status, cust.operational_status
    FROM data_objects d
    INNER JOIN devices dev ON dev.id = d.device_id
    INNER JOIN sites s ON s.id = d.site_id
    INNER JOIN customers cust ON cust.id = d.customer_id
    WHERE d.id = %s::uuid AND d.customer_id = %s::uuid
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (data_object_id, customer_id))
            row = cur.fetchone()
            if not row:
                return None
            payload, kpi, health, lifecycle, dev_op, site_op, cust_op = row
            if str(lifecycle).lower() != "published":
                return None
            for op in (dev_op, site_op, cust_op):
                if str(op or "active").lower() != "active":
                    return None
            out = dict(payload or {})
            out["_kpi"] = dict(kpi or {})
            if health:
                out["_health_status"] = health
            return out
    finally:
        conn.close()


def load_static_ingestion_payload(
    *, static_ingestion_id: str, customer_id: str
) -> dict[str, Any] | None:
    sql = """
    SELECT payload_json, end_at
    FROM static_ingestions
    WHERE id = %s::uuid AND customer_id = %s::uuid
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (static_ingestion_id, customer_id))
            row = cur.fetchone()
            if not row:
                return None
            payload, end_at = row
            now = datetime.now(timezone.utc)
            if end_at is not None:
                if end_at.tzinfo is None:
                    end_at = end_at.replace(tzinfo=timezone.utc)
                if end_at <= now:
                    return None
            return dict(payload or {})
    finally:
        conn.close()


def insert_execution_completed(
    *,
    workflow_id: str,
    input_data_object_id: str,
    trigger_type: str,
    status: str,
    trace_id: str | None,
    node_outputs: dict[str, Any],
    error_message: str | None,
) -> str:
    eid = str(uuid.uuid4())
    sql = """
    INSERT INTO workflow_executions (
      id, workflow_id, trigger_type, input_data_object_id, status,
      trace_id, node_outputs_json, error_message, finished_at
    ) VALUES (
      %s::uuid, %s::uuid, %s, %s::uuid, %s,
      %s, %s, %s, %s
    )
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (
                    eid,
                    workflow_id,
                    trigger_type,
                    input_data_object_id,
                    status,
                    trace_id,
                    Json(node_outputs),
                    error_message,
                    datetime.now(timezone.utc),
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return eid


def insert_result_object_row(
    *,
    execution_id: str,
    workflow_id: str,
    terminate_node_id: str | None,
    result_object_name: str,
    customer_id: str,
    site_id: str,
    payload: dict[str, Any],
    health_status: str | None,
) -> str:
    rid = str(uuid.uuid4())
    sql = """
    INSERT INTO workflow_result_objects (
      id, workflow_execution_id, workflow_id, terminate_node_id,
      result_object_name, customer_id, site_id, payload_json, health_status
    ) VALUES (
      %s::uuid, %s::uuid, %s::uuid, %s::uuid,
      %s, %s::uuid, %s::uuid, %s, %s
    )
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (
                    rid,
                    execution_id,
                    workflow_id,
                    terminate_node_id,
                    result_object_name,
                    customer_id,
                    site_id,
                    Json(payload),
                    health_status,
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return rid


def insert_node_output_row(
    *, execution_id: str, node_id: str | None, payload: dict[str, Any]
) -> None:
    oid = str(uuid.uuid4())
    sql = """
    INSERT INTO workflow_node_outputs (id, workflow_execution_id, node_id, payload_json)
    VALUES (%s::uuid, %s::uuid, %s::uuid, %s)
    """
    conn = psycopg2.connect(_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (oid, execution_id, node_id, Json(payload)),
            )
        conn.commit()
    finally:
        conn.close()
