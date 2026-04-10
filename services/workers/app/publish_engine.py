"""Kafka → active published services → REST/MQTT + logs + alerts."""

from __future__ import annotations

import logging
from typing import Any

import psycopg2

from app.alert_emit import emit_alert, redis_set_service_status
from app.publish_failure_alerts import (
    publish_success_clear_streak,
    redis_for_publish_policy,
    should_emit_publish_failure_alert,
)
from app.publish_db import (
    _db_url,
    fetch_active_services,
    insert_delivery_log,
    load_data_object_payload,
    load_result_object_payload,
    resolve_result_object_tenant,
    update_service_publish_outcome,
)
from app.publish_dispatch import dispatch_publish

log = logging.getLogger(__name__)


def process_kafka_value(data: dict[str, Any]) -> None:
    kind = data.get("kind")
    trace_id = data.get("trace_id")
    trace_s = str(trace_id)[:128] if trace_id else None

    if kind == "data_object_created":
        customer_id = str(data.get("customer_id") or "")
        oid = str(data.get("data_object_id") or "")
        if not customer_id or not oid:
            log.warning("data_object_created missing ids")
            return
        _run_for_source(
            customer_id=customer_id,
            source_type="data_object",
            source_object_id=oid,
            source_event_id=oid,
            trace_id=trace_s,
            loader=lambda conn: load_data_object_payload(conn, customer_id=customer_id, data_object_id=oid),
        )
        return

    if kind == "result_object_created":
        oid = str(data.get("result_object_id") or "")
        customer_id = str(data.get("customer_id") or "")
        if not customer_id and oid:
            conn = psycopg2.connect(_db_url())
            try:
                customer_id, _ = resolve_result_object_tenant(conn, result_object_id=oid)
            finally:
                conn.close()
        if not customer_id or not oid:
            log.warning("result_object_created missing tenant")
            return
        _run_for_source(
            customer_id=customer_id,
            source_type="result_object",
            source_object_id=oid,
            source_event_id=oid,
            trace_id=trace_s,
            loader=lambda conn: load_result_object_payload(conn, customer_id=customer_id, result_object_id=oid),
        )
        return

    log.debug("publish_engine skip kind=%s", kind)


def _run_for_source(
    *,
    customer_id: str,
    source_type: str,
    source_object_id: str,
    source_event_id: str,
    trace_id: str | None,
    loader,
) -> None:
    conn = psycopg2.connect(_db_url())
    try:
        payload = loader(conn)
        if not payload:
            log.warning("publish: source payload missing %s %s", source_type, source_object_id)
            return
        services = fetch_active_services(
            conn,
            customer_id=customer_id,
            source_type=source_type,
            source_object_id=source_object_id,
        )
        if not services:
            return
        r_policy = redis_for_publish_policy()
        failures: list[tuple[dict[str, Any], str | None]] = []
        for svc in services:
            sid = str(svc["id"])
            proto = str(svc["publish_protocol"])
            cfg = svc["target_config_json"]
            if not isinstance(cfg, dict):
                cfg = {}
            ok, code, msg = dispatch_publish(
                publish_protocol=proto,
                target_config_json=cfg,
                payload=payload,
            )
            insert_delivery_log(
                conn,
                published_service_id=sid,
                source_event_id=source_event_id,
                ok=ok,
                response_code=code,
                response_message=msg,
                trace_id=trace_id,
            )
            update_service_publish_outcome(
                conn,
                service_id=sid,
                ok=ok,
                error_message=msg if not ok else None,
            )
            redis_set_service_status(
                sid,
                {
                    "ok": ok,
                    "response_code": code,
                    "trace_id": trace_id,
                    "source_type": source_type,
                    "source_object_id": source_object_id,
                },
            )
            if ok:
                publish_success_clear_streak(r_policy, sid)
            else:
                failures.append((svc, msg))
        conn.commit()
        for svc, msg in failures:
            sid = str(svc["id"])
            try:
                if not should_emit_publish_failure_alert(r_policy, sid):
                    continue
                emit_alert(
                    category="publish",
                    severity="warning",
                    title=f"Published service delivery failed: {svc.get('name') or sid}",
                    message=msg,
                    customer_id=customer_id,
                    site_id=str(svc["site_id"]) if svc.get("site_id") else None,
                    source_component="worker-publish",
                    source_object_type="published_service",
                    source_object_id=sid,
                    trace_id=trace_id,
                )
            except Exception:
                log.exception("emit_alert after publish failure")
    except Exception:
        conn.rollback()
        log.exception("publish_engine transaction failed")
        raise
    finally:
        conn.close()
