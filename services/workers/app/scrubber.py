"""worker-scrubber — scrubber.input → data_objects + data_object.created."""

from __future__ import annotations

import json
import logging
import os

from kafka import KafkaConsumer

from app._kafka import bootstrap_servers
from app.alert_emit import emit_alert as worker_emit_alert
from app.data_object_lifecycle import DATA_COMPILED, DATA_FAILED, DATA_PUBLISHED
from app.kafka_publish import emit_data_object_created
from app.logging_setup import configure_logging
from app.field_catalog_service import build_ai_projection_document
from app.metadata_db import fetch_site_mapping_studio, insert_data_object
from app.minio_worker import read_object_slice
from app.pipeline import emit
from app.scrubber_engine import ScrubberRunResult, run_scrubber
from app.endpoint_version_identity import process_raw_version_identity
from app.v2_resolution import try_write_v2_from_scrubber
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)


def _data_object_feature_flags(
    payload: dict[str, object] | None,
    kpi_json: dict[str, object] | None,
    health_status: str | None,
) -> tuple[bool, bool, bool, bool]:
    p = payload if isinstance(payload, dict) else {}
    k = kpi_json if isinstance(kpi_json, dict) else {}
    gps = p.get("gps")
    has_gps = isinstance(gps, dict) and bool(gps.get("map_eligible"))
    has_kpi = len(k) > 0
    has_health = isinstance(health_status, str) and health_status.lower() in ("green", "yellow", "red")
    metrics = k.get("metrics")
    has_timeseries = False
    if isinstance(metrics, dict):
        for meta in metrics.values():
            if not isinstance(meta, dict):
                continue
            if meta.get("store_history") is False:
                continue
            has_timeseries = True
            break
    return has_gps, has_kpi, has_health, has_timeseries


def _max_read_bytes() -> int:
    raw = os.environ.get("SCRUBBER_RAW_MAX_BYTES", os.environ.get("RAW_INGEST_MAX_BYTES", "33554432"))
    try:
        return max(1, min(int(raw), 64 * 1024 * 1024))
    except ValueError:
        return 33554432


def _bucket() -> str:
    return os.environ.get("MINIO_BUCKET_RAW", "aar-raw")


def _topic_in() -> str:
    return os.environ.get("KAFKA_SCRUBBER_INPUT_TOPIC", "scrubber.input")


def _process_envelope(env: dict) -> None:
    raw_object_id = str(env.get("raw_object_id", ""))
    device_id = str(env.get("device_id", ""))
    customer_id = str(env.get("customer_id", ""))
    storage_key = env.get("storage_key")
    trace_id = env.get("trace_id")
    if isinstance(trace_id, str):
        trace_s = trace_id[:64] if trace_id else None
    else:
        trace_s = None

    size_bytes = env.get("size_bytes")
    if not isinstance(size_bytes, int) or size_bytes < 0:
        log.error("scrubber invalid size_bytes raw_object_id=%s", raw_object_id)
        return

    content_type = env.get("content_type")
    if content_type is not None and not isinstance(content_type, str):
        content_type = None

    site_id, mapping, scrubber_studio = fetch_site_mapping_studio(device_id=device_id)
    if not site_id:
        log.error("scrubber device not found device_id=%s", device_id)
        return

    if not scrubber_studio:
        log.warning(
            "scrubber no scrubberStudio mapping device_id=%s raw_object_id=%s",
            device_id,
            raw_object_id,
        )
        # MQTT/v2 endpoint mode: allow passthrough V2 writes even when legacy scrubber mapping is absent.
        endpoint_id = env.get("endpoint_id")
        if isinstance(endpoint_id, str) and endpoint_id.strip():
            cap = _max_read_bytes()
            to_read = min(size_bytes, cap)
            try:
                raw_bytes = read_object_slice(bucket=_bucket(), key=str(storage_key), offset=0, length=to_read)
                try:
                    process_raw_version_identity(
                        raw_bytes=raw_bytes,
                        content_type=content_type,
                        endpoint_id=endpoint_id.strip(),
                        device_id=device_id,
                        customer_id=customer_id,
                        site_id=site_id,
                        raw_object_id=raw_object_id,
                        trace_id=trace_s,
                    )
                except Exception:
                    log.debug("endpoint_version_identity (passthrough) failed", exc_info=True)
                payload_obj = json.loads(raw_bytes.decode("utf-8"))
                if not isinstance(payload_obj, dict):
                    payload_obj = {"_raw_text": raw_bytes.decode("utf-8", errors="replace")}
            except Exception:
                payload_obj = {}
            try:
                try_write_v2_from_scrubber(
                    device_id=device_id,
                    customer_id=customer_id,
                    site_id=site_id,
                    raw_object_id=raw_object_id,
                    result=ScrubberRunResult(
                        object_name="Data object",
                        payload=payload_obj,
                        kpi={},
                        health_status="green",
                        health_code="pass_through",
                        health_message="No scrubber mapping; passthrough payload for v2 resolution.",
                        scrubber_version=None,
                        health_details={},
                    ),
                    scrubber_envelope=env,
                )
            except Exception:
                log.debug("v2 passthrough resolution skipped", exc_info=True)
        oid = insert_data_object(
            customer_id=customer_id,
            site_id=site_id,
            device_id=device_id,
            raw_data_object_id=raw_object_id,
            name="Data object",
            payload={},
            kpi_json={},
            health_status="red",
            health_code="no_scrubber",
            health_message="device_objects.mapping.scrubberStudio missing",
            scrubber_version=None,
            has_gps=False,
            has_kpi=False,
            has_health=True,
            has_timeseries=False,
            lifecycle_status=DATA_FAILED,
            error_message="scrubberStudio missing on device_object",
            trace_id=trace_s,
            ai_projection=None,
        )
        emit(
            log,
            component="worker-scrubber",
            action="data_object_insert",
            status="error",
            data_object_id=oid,
            lifecycle_status=DATA_FAILED,
            trace_id=trace_s,
        )
        try:
            worker_emit_alert(
                category="scrubber",
                severity="warning",
                title="Scrubber: device mapping missing",
                message="scrubberStudio missing on device_object; data_object marked failed.",
                customer_id=customer_id,
                site_id=site_id,
                device_id=device_id,
                source_component="worker-scrubber",
                source_object_type="raw_data_object",
                source_object_id=raw_object_id,
                trace_id=trace_s,
            )
        except Exception:
            log.debug("scrubber alert emit failed", exc_info=True)
        return

    cap = _max_read_bytes()
    to_read = min(size_bytes, cap)
    if size_bytes > cap:
        log.warning(
            "scrubber truncating read raw_object_id=%s size=%s cap=%s",
            raw_object_id,
            size_bytes,
            cap,
        )

    try:
        raw_bytes = read_object_slice(bucket=_bucket(), key=str(storage_key), offset=0, length=to_read)
    except Exception:
        log.exception(
            "scrubber minio read failed raw_object_id=%s key=%s",
            raw_object_id,
            storage_key,
        )
        oid = insert_data_object(
            customer_id=customer_id,
            site_id=site_id,
            device_id=device_id,
            raw_data_object_id=raw_object_id,
            name="Data object",
            payload={},
            kpi_json={},
            health_status="red",
            health_code="minio_read",
            health_message="Failed to read raw object from object storage",
            scrubber_version=None,
            has_gps=False,
            has_kpi=False,
            has_health=True,
            has_timeseries=False,
            lifecycle_status=DATA_FAILED,
            error_message="minio read failed",
            trace_id=trace_s,
            ai_projection=None,
        )
        emit(
            log,
            component="worker-scrubber",
            action="data_object_insert",
            status="error",
            data_object_id=oid,
            trace_id=trace_s,
        )
        try:
            worker_emit_alert(
                category="scrubber",
                severity="warning",
                title="Scrubber: raw object read failed",
                message="MinIO read failed for raw object",
                customer_id=customer_id,
                site_id=site_id,
                device_id=device_id,
                source_component="worker-scrubber",
                source_object_type="raw_data_object",
                source_object_id=raw_object_id,
                trace_id=trace_s,
            )
        except Exception:
            log.debug("scrubber alert emit failed", exc_info=True)
        return

    ep_raw = env.get("endpoint_id")
    ep_s = ep_raw.strip() if isinstance(ep_raw, str) and ep_raw.strip() else None
    try:
        process_raw_version_identity(
            raw_bytes=raw_bytes,
            content_type=content_type,
            endpoint_id=ep_s,
            device_id=device_id,
            customer_id=customer_id,
            site_id=site_id,
            raw_object_id=raw_object_id,
            trace_id=trace_s,
        )
    except Exception:
        log.debug("endpoint_version_identity stage failed", exc_info=True)

    try:
        result = run_scrubber(
            raw_bytes=raw_bytes,
            content_type=content_type,
            scrubber_studio=scrubber_studio,
        )
    except Exception as e:
        log.exception("scrubber transform failed raw_object_id=%s", raw_object_id)
        oid = insert_data_object(
            customer_id=customer_id,
            site_id=site_id,
            device_id=device_id,
            raw_data_object_id=raw_object_id,
            name="Data object",
            payload={},
            kpi_json={},
            health_status="red",
            health_code="transform_error",
            health_message=str(e)[:2000],
            scrubber_version=None,
            has_gps=False,
            has_kpi=False,
            has_health=True,
            has_timeseries=False,
            lifecycle_status=DATA_FAILED,
            error_message=str(e)[:2000],
            trace_id=trace_s,
            ai_projection=None,
        )
        emit(
            log,
            component="worker-scrubber",
            action="data_object_insert",
            status="error",
            data_object_id=oid,
            trace_id=trace_s,
        )
        try:
            worker_emit_alert(
                category="scrubber",
                severity="warning",
                title="Scrubber: transform failed",
                message=str(e)[:2000],
                customer_id=customer_id,
                site_id=site_id,
                device_id=device_id,
                source_component="worker-scrubber",
                source_object_type="raw_data_object",
                source_object_id=raw_object_id,
                trace_id=trace_s,
            )
        except Exception:
            log.debug("scrubber alert emit failed", exc_info=True)
        return

    published = bool(scrubber_studio.get("published"))
    lifecycle = DATA_PUBLISHED if published else DATA_COMPILED
    has_gps, has_kpi, has_health, has_timeseries = _data_object_feature_flags(
        result.payload, result.kpi, result.health_status
    )

    catalog = mapping.get("fieldCatalog") if isinstance(mapping.get("fieldCatalog"), dict) else None
    ai_proj = build_ai_projection_document(
        catalog=catalog,
        payload=result.payload if isinstance(result.payload, dict) else {},
        kpi_json=result.kpi if isinstance(result.kpi, dict) else {},
        object_type=result.object_name,
    )

    oid = insert_data_object(
        customer_id=customer_id,
        site_id=site_id,
        device_id=device_id,
        raw_data_object_id=raw_object_id,
        name=result.object_name,
        payload=result.payload,
        kpi_json=result.kpi,
        health_status=result.health_status,
        health_code=result.health_code,
        health_message=result.health_message,
        scrubber_version=result.scrubber_version,
        has_gps=has_gps,
        has_kpi=has_kpi,
        has_health=has_health,
        has_timeseries=has_timeseries,
        lifecycle_status=lifecycle,
        error_message=None,
        trace_id=trace_s,
        ai_projection=ai_proj,
    )

    emit(
        log,
        component="worker-scrubber",
        action="data_object_insert",
        status="ok",
        data_object_id=oid,
        lifecycle_status=lifecycle,
        trace_id=trace_s,
    )

    try:
        emit_data_object_created(
            payload={
                "kind": "data_object_created",
                "data_object_id": oid,
                "raw_object_id": raw_object_id,
                "device_id": device_id,
                "customer_id": customer_id,
                "site_id": site_id,
                "has_gps": has_gps,
                "has_kpi": has_kpi,
                "has_health": has_health,
                "has_timeseries": has_timeseries,
                "lifecycle_status": lifecycle,
                "trace_id": trace_s,
            }
        )
        emit(
            log,
            component="worker-scrubber",
            action="data_object_created_emitted",
            status="ok",
            data_object_id=oid,
            trace_id=trace_s,
        )
    except Exception:
        log.exception("emit data_object.created failed data_object_id=%s", oid)
        emit(
            log,
            component="worker-scrubber",
            action="data_object_created_emitted",
            status="error",
            data_object_id=oid,
            trace_id=trace_s,
        )

    try:
        try_write_v2_from_scrubber(
            device_id=device_id,
            customer_id=customer_id,
            site_id=site_id,
            raw_object_id=raw_object_id,
            result=result,
            scrubber_envelope=env,
        )
    except Exception:
        log.debug("v2_resolution after scrub skipped", exc_info=True)


def main() -> None:
    log.debug("worker-scrubber main() starting")
    servers = bootstrap_servers()
    consumer = KafkaConsumer(
        _topic_in(),
        bootstrap_servers=servers,
        group_id="worker-scrubber",
        auto_offset_reset="earliest",
        enable_auto_commit=True,
        value_deserializer=lambda b: b,
    )
    emit(
        log,
        component="worker-scrubber",
        action="subscriber_started",
        status="ok",
        topic=_topic_in(),
        group_id="worker-scrubber",
    )
    log.info("worker-scrubber listening on %s", _topic_in())
    start_worker_heartbeat("worker-scrubber")
    for msg in consumer:
        vb = len(msg.value) if msg.value else 0
        emit(
            log,
            component="worker-scrubber",
            action="payload_received",
            status="ok",
            topic=msg.topic,
            partition=msg.partition,
            offset=msg.offset,
            value_bytes=vb,
        )
        if not msg.value:
            continue
        try:
            data = json.loads(msg.value.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            log.warning("scrubber invalid json: %s", e)
            continue
        if not isinstance(data, dict):
            continue
        k = data.get("kind")
        if k is not None and k != "scrubber_input":
            log.debug("scrubber skip kind=%s", k)
            continue
        _process_envelope(data)


if __name__ == "__main__":
    main()
