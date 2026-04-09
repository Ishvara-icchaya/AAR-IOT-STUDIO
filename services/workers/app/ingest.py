"""worker-ingest — consumes raw.ingest (canonical envelope v1)."""

from __future__ import annotations

import json
import logging

from kafka import KafkaConsumer

from app._kafka import bootstrap_servers
from app.alert_emit import emit_alert as worker_emit_alert
from app.ingest_subscribers import generic, modbus, mqtt  # noqa: F401 — side-effect: register
from app.ingest_subscribers.registry import dispatch_envelope
from app.kafka_publish import emit_scrubber_input
from app.logging_setup import configure_logging
from app.pipeline import emit
from app.worker_settings import settings
from app.raw_ingest_contract import RawIngestEnvelopeError, parse_raw_ingest_envelope_bytes
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def main() -> None:
    log.debug("worker-ingest main() starting")
    servers = bootstrap_servers()
    log.debug("worker-ingest bootstrap_servers=%s", servers)
    consumer = KafkaConsumer(
        "raw.ingest",
        bootstrap_servers=servers,
        group_id="worker-ingest",
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: b,
    )
    emit(
        log,
        component="worker-ingest",
        action="subscriber_started",
        status="ok",
        topic="raw.ingest",
        group_id="worker-ingest",
        bootstrap_hint=str(servers)[:120],
    )
    log.info("worker-ingest listening on %s topic raw.ingest", servers)
    start_worker_heartbeat("worker-ingest")
    for msg in consumer:
        vb = len(msg.value) if msg.value else 0
        emit(
            log,
            component="worker-ingest",
            action="payload_received",
            status="ok",
            topic=msg.topic,
            partition=msg.partition,
            offset=msg.offset,
            value_bytes=vb,
        )
        if not msg.value:
            emit(
                log,
                component="worker-ingest",
                action="envelope_parse",
                status="error",
                error="empty_value",
            )
            continue
        try:
            env = parse_raw_ingest_envelope_bytes(msg.value)
        except RawIngestEnvelopeError as e:
            emit(
                log,
                component="worker-ingest",
                action="envelope_parse",
                status="error",
                error=str(e)[:300],
            )
            log.warning("invalid ingest envelope: %s", e)
            try:
                data = json.loads(msg.value.decode("utf-8"))
                cid = str(data.get("customer_id") or "") if isinstance(data, dict) else ""
                did = str(data.get("device_id") or "") if isinstance(data, dict) else ""
                if cid:
                    worker_emit_alert(
                        category="ingest",
                        severity="warning",
                        title="Ingest: invalid envelope",
                        message=str(e)[:2000],
                        customer_id=cid,
                        site_id=None,
                        device_id=did or None,
                        source_component="worker-ingest",
                        source_object_type="raw_ingest_envelope",
                        source_object_id=str(data.get("raw_object_id") or "") or None,
                        trace_id=str(data.get("trace_id") or "")[:128] or None,
                    )
            except Exception:
                log.debug("ingest alert skipped for parse error", exc_info=True)
            continue
        emit(
            log,
            component="worker-ingest",
            action="envelope_validated",
            status="ok",
            raw_object_id=str(env.get("raw_object_id")),
            device_id=str(env.get("device_id")),
            protocol_id=env.get("protocol_id"),
            trace_id=env.get("trace_id"),
        )
        try:
            dispatch_envelope(env)
        except Exception as e:
            log.exception("ingest dispatch_envelope failed")
            try:
                worker_emit_alert(
                    category="ingest",
                    severity="warning",
                    title="Ingest: subscriber handler failed",
                    message=str(e)[:2000],
                    customer_id=str(env.get("customer_id") or ""),
                    site_id=None,
                    device_id=str(env.get("device_id") or "") or None,
                    source_component="worker-ingest",
                    source_object_type="raw_data_object",
                    source_object_id=str(env.get("raw_object_id") or "") or None,
                    trace_id=str(env.get("trace_id") or "")[:128] or None,
                )
            except Exception:
                log.debug("ingest alert emit failed", exc_info=True)
        if settings.KAFKA_EMIT_SCRUBBER_INPUT:
            try:
                emit_scrubber_input(env)
                emit(
                    log,
                    component="worker-ingest",
                    action="scrubber_input_emitted",
                    status="ok",
                    raw_object_id=str(env.get("raw_object_id")),
                    trace_id=env.get("trace_id"),
                )
            except Exception as ex:
                log.exception(
                    "emit scrubber.input failed raw_object_id=%s",
                    env.get("raw_object_id"),
                )
                emit(
                    log,
                    component="worker-ingest",
                    action="scrubber_input_emitted",
                    status="error",
                    raw_object_id=str(env.get("raw_object_id")),
                    trace_id=env.get("trace_id"),
                )
                try:
                    worker_emit_alert(
                        category="ingest",
                        severity="warning",
                        title="Ingest: scrubber.input Kafka emit failed",
                        message=str(ex)[:2000],
                        customer_id=str(env.get("customer_id") or ""),
                        site_id=None,
                        device_id=str(env.get("device_id") or "") or None,
                        source_component="worker-ingest",
                        source_object_type="raw_data_object",
                        source_object_id=str(env.get("raw_object_id") or "") or None,
                        trace_id=str(env.get("trace_id") or "")[:128] or None,
                    )
                except Exception:
                    log.debug("ingest kafka alert emit failed", exc_info=True)


if __name__ == "__main__":
    main()
