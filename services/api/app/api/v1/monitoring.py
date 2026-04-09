import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.pipeline_log import emit as pipeline_emit
from app.core.redis_sync import get_redis
from app.db.session import get_db
from app.models.user import User
from app.schemas.monitoring import (
    MonitoringAiResponse,
    MonitoringOverviewResponse,
    MonitoringQueueRow,
    MonitoringResourceRow,
    MonitoringServiceDetail,
    MonitoringServiceRow,
    MonitoringStorageRow,
)
from app.services import ingress_metrics
from app.services.alert_emit import emit_alert
from app.services import monitoring_probes
from app.services.monitoring_service import (
    build_ai_monitoring_payload,
    build_overview,
    build_queues_payload,
    build_resources,
    build_service_detail,
    build_services,
    build_storage_payload,
    collect_platform_state,
)

router = APIRouter()
log = logging.getLogger(__name__)


def _emit_monitoring_if_cooldown(
    *,
    db: Session,
    r,
    customer_id: uuid.UUID,
    cooldown_suffix: str,
    severity: str,
    title: str,
    message: str | None,
) -> None:
    ex = max(60, int(settings.monitoring_deep_cooldown_seconds))
    key = f"monitoring:deep:alert:{cooldown_suffix}:{customer_id}"
    should_emit = True
    if r:
        try:
            should_emit = bool(r.set(key, "1", nx=True, ex=ex))
        except Exception:
            should_emit = True
    if not should_emit:
        return
    try:
        emit_alert(
            db=db,
            category="monitoring",
            severity=severity,
            title=title,
            message=message,
            customer_id=customer_id,
            site_id=None,
            device_id=None,
            source_component="api.monitoring",
            source_object_type=None,
            source_object_id=None,
            trace_id=None,
        )
    except Exception:
        log.debug("monitoring alert emit failed suffix=%s", cooldown_suffix, exc_info=True)


@router.get("/overview", response_model=MonitoringOverviewResponse)
def monitoring_overview(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    state = collect_platform_state(db)
    return build_overview(db, user.customer_id, state)


@router.get("/services", response_model=list[MonitoringServiceRow])
def monitoring_services(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    state = collect_platform_state(db)
    return build_services(db, user.customer_id, state)


@router.get("/services/{service_name}", response_model=MonitoringServiceDetail)
def monitoring_service_detail(
    service_name: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    state = collect_platform_state(db)
    row = build_service_detail(service_name, db, user.customer_id, state)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown service")
    return row


@router.get("/queues", response_model=list[MonitoringQueueRow])
def monitoring_queues(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = user
    state = collect_platform_state(db)
    return build_queues_payload(state)


@router.get("/resources", response_model=list[MonitoringResourceRow])
def monitoring_resources(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = user
    state = collect_platform_state(db)
    return build_resources(state)


@router.get("/storage", response_model=list[MonitoringStorageRow])
def monitoring_storage(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = user
    state = collect_platform_state(db)
    return build_storage_payload(db, state)


@router.get("/ai", response_model=MonitoringAiResponse)
def monitoring_ai(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    state = collect_platform_state(db)
    return build_ai_monitoring_payload(state, db=db, customer_id=user.customer_id)


@router.get("/health")
def stack_health():
    log.debug("monitoring.stack_health")
    pipeline_emit(
        log,
        component="api.monitoring",
        action="stack_health",
        status="ok",
        detail="scaffold_metrics_pending",
    )
    return {"services": {}, "detail": "scaffold"}


@router.get("/deep")
def monitoring_deep(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Authenticated stack probe; emits at most one alert per check per tenant per cooldown on failure."""
    log.debug("monitoring.deep")
    r_cached = get_redis()
    cid = user.customer_id
    ex = max(60, int(settings.monitoring_deep_cooldown_seconds))

    # --- Postgres
    database_ok = True
    database_error: str | None = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        database_ok = False
        database_error = str(e)[:2000]
        log.warning("monitoring.deep db check failed: %s", database_error)
        key = f"monitoring:deep:alert:{cid}"
        should_emit = True
        if r_cached:
            try:
                should_emit = bool(r_cached.set(key, "1", nx=True, ex=ex))
            except Exception:
                should_emit = True
        if should_emit:
            try:
                emit_alert(
                    db=db,
                    category="monitoring",
                    severity="critical",
                    title="Monitoring: metadata database unreachable",
                    message=database_error,
                    customer_id=cid,
                    site_id=None,
                    device_id=None,
                    source_component="api.monitoring",
                    source_object_type=None,
                    source_object_id=None,
                    trace_id=None,
                )
            except Exception:
                log.debug("monitoring deep alert emit failed", exc_info=True)

    # --- Redis (fresh connection; independent of get_redis cache)
    redis_ok, redis_err = monitoring_probes.probe_redis(settings.redis_url)
    r_ops = r_cached
    if redis_ok and r_ops is None:
        try:
            import redis

            r_ops = redis.from_url(
                settings.redis_url,
                socket_connect_timeout=2,
                socket_timeout=2,
                decode_responses=True,
            )
            r_ops.ping()
        except Exception:
            r_ops = None

    if not redis_ok:
        log.warning("monitoring.deep redis check failed: %s", redis_err)
        _emit_monitoring_if_cooldown(
            db=db,
            r=r_ops,
            customer_id=cid,
            cooldown_suffix="redis",
            severity="critical",
            title="Monitoring: Redis unreachable",
            message=redis_err,
        )

    # --- Kafka
    kafka_ok, kafka_err = monitoring_probes.probe_kafka(settings.kafka_bootstrap_servers)
    if not kafka_ok:
        log.warning("monitoring.deep kafka check failed: %s", kafka_err)
        _emit_monitoring_if_cooldown(
            db=db,
            r=r_ops,
            customer_id=cid,
            cooldown_suffix="kafka",
            severity="critical",
            title="Monitoring: Kafka unreachable",
            message=kafka_err,
        )

    # --- MinIO
    minio_ok, minio_err = monitoring_probes.probe_minio()
    if not minio_ok:
        log.warning("monitoring.deep minio check failed: %s", minio_err)
        _emit_monitoring_if_cooldown(
            db=db,
            r=r_ops,
            customer_id=cid,
            cooldown_suffix="minio",
            severity="critical",
            title="Monitoring: MinIO unreachable or raw bucket missing",
            message=minio_err,
        )

    # --- MQTT broker (platform Mosquitto) — TCP probe from API; ingest alerts when required
    mqtt_broker_ok = True
    mqtt_broker_err: str | None = None
    if settings.platform_mqtt_broker_enabled:
        mqtt_broker_ok, mqtt_broker_err = monitoring_probes.probe_mqtt_tcp(
            settings.mqtt_broker_probe_host,
            settings.mqtt_broker_probe_port,
        )
        if settings.mqtt_ingest_alert_on_broker_down and not mqtt_broker_ok:
            ex = max(60, int(settings.monitoring_deep_cooldown_seconds))
            key = f"monitoring:deep:alert:ingest:mqtt-broker:{cid}"
            should_emit = True
            if r_ops:
                try:
                    should_emit = bool(r_ops.set(key, "1", nx=True, ex=ex))
                except Exception:
                    should_emit = True
            if should_emit:
                try:
                    emit_alert(
                        db=db,
                        category="ingest",
                        severity="critical",
                        title="Ingest: MQTT broker (Mosquitto) unreachable",
                        message=(mqtt_broker_err or "TCP connect failed")[:2000],
                        customer_id=cid,
                        site_id=None,
                        device_id=None,
                        source_component="api.monitoring.mqtt",
                        source_object_type=None,
                        source_object_id=None,
                        trace_id=None,
                    )
                except Exception:
                    log.debug("mqtt broker ingest alert emit failed", exc_info=True)

    # --- REST ingest: elevated HTTP failures in rolling window (see ingress_metrics)
    rest_snap = ingress_metrics.get_rest_ingest_snapshot()
    rest_fails = rest_snap.get("failures_last_15m")
    rest_thr = max(3, int(settings.ingest_rest_failures_alert_threshold_15m))
    if isinstance(rest_fails, int) and rest_fails >= rest_thr:
        ex = max(60, int(settings.monitoring_deep_cooldown_seconds))
        key = f"monitoring:deep:alert:ingest:rest-failures:{cid}"
        should_emit = True
        if r_ops:
            try:
                should_emit = bool(r_ops.set(key, "1", nx=True, ex=ex))
            except Exception:
                should_emit = True
        if should_emit:
            try:
                emit_alert(
                    db=db,
                    category="ingest",
                    severity="warning",
                    title="Ingest: elevated REST raw ingest failures",
                    message=(
                        f"Failures in ~15m window: {rest_fails} (threshold {rest_thr}). "
                        f"Last error: {rest_snap.get('last_error') or 'n/a'}"[:2000]
                    ),
                    customer_id=cid,
                    site_id=None,
                    device_id=None,
                    source_component="api.monitoring.rest_ingest",
                    source_object_type=None,
                    source_object_id=None,
                    trace_id=None,
                )
            except Exception:
                log.debug("rest ingest alert emit failed", exc_info=True)

    # --- Per-protocol ingress quality (~15m rolling zsets on Redis) + optional hot-stream inactivity
    if redis_ok and r_ops:
        ex = max(60, int(settings.monitoring_deep_cooldown_seconds))
        wind = 900
        min_msgs = max(1, int(settings.ingest_inactivity_min_prior_messages))
        inact_sec = float(settings.ingest_hot_stream_inactivity_seconds)

        def _ingest_emit_deep(*, key_suffix: str, title: str, message: str, component: str) -> None:
            key = f"monitoring:deep:alert:ingest:{key_suffix}:{cid}"
            should_emit = True
            try:
                should_emit = bool(r_ops.set(key, "1", nx=True, ex=ex))
            except Exception:
                should_emit = True
            if not should_emit:
                return
            try:
                emit_alert(
                    db=db,
                    category="ingest",
                    severity="warning",
                    title=title,
                    message=message[:2000],
                    customer_id=cid,
                    site_id=None,
                    device_id=None,
                    source_component=component,
                    source_object_type=None,
                    source_object_id=None,
                    trace_id=None,
                )
            except Exception:
                log.debug("ingress deep alert emit failed suffix=%s", key_suffix, exc_info=True)

        if settings.coap_listener_deployed:
            n = ingress_metrics.count_quality_events("coap", window_sec=wind)
            thr = max(3, int(settings.ingest_coap_quality_events_alert_threshold_15m))
            if isinstance(n, int) and n >= thr:
                _ingest_emit_deep(
                    key_suffix="coap-quality",
                    title="Ingest: elevated CoAP client/parse errors",
                    message=f"Quality signals in ~15m window: {n} (threshold {thr}). Check CoAP payloads and device config.",
                    component="api.monitoring.ingest.coap",
                )
            if inact_sec > 0:
                msg = ingress_metrics.hot_stream_inactivity_message(
                    "CoAP",
                    ingress_metrics.coap_listener_snapshot(),
                    min_prior_messages=min_msgs,
                    max_silence_sec=inact_sec,
                )
                if msg:
                    _ingest_emit_deep(
                        key_suffix="coap-inactivity",
                        title="Ingest: CoAP hot stream idle",
                        message=msg,
                        component="api.monitoring.ingest.coap",
                    )

        if settings.websocket_ingest_deployed:
            n = ingress_metrics.count_quality_events("websocket", window_sec=wind)
            thr = max(3, int(settings.ingest_websocket_reconnect_events_alert_threshold_15m))
            if isinstance(n, int) and n >= thr:
                _ingest_emit_deep(
                    key_suffix="ws-reconnect",
                    title="Ingest: elevated WebSocket reconnect churn",
                    message=f"Reconnect/error signals in ~15m: {n} (threshold {thr}). Check URL, TLS, and upstream availability.",
                    component="api.monitoring.ingest.websocket",
                )
            if inact_sec > 0:
                msg = ingress_metrics.hot_stream_inactivity_message(
                    "WebSocket",
                    ingress_metrics.websocket_listener_snapshot(),
                    min_prior_messages=min_msgs,
                    max_silence_sec=inact_sec,
                )
                if msg:
                    _ingest_emit_deep(
                        key_suffix="ws-inactivity",
                        title="Ingest: WebSocket hot stream idle",
                        message=msg,
                        component="api.monitoring.ingest.websocket",
                    )

        if settings.rest_poller_deployed:
            n = ingress_metrics.count_quality_events("rest_poller", window_sec=wind)
            thr = max(3, int(settings.ingest_rest_poller_quality_events_alert_threshold_15m))
            if isinstance(n, int) and n >= thr:
                _ingest_emit_deep(
                    key_suffix="rest-poller-quality",
                    title="Ingest: elevated REST poller failures",
                    message=f"Poll/parse/transport signals in ~15m: {n} (threshold {thr}). Check polling_url, auth, and timeouts.",
                    component="api.monitoring.ingest.rest_poller",
                )
            if inact_sec > 0:
                msg = ingress_metrics.hot_stream_inactivity_message(
                    "REST poller",
                    ingress_metrics.rest_poller_snapshot(),
                    min_prior_messages=min_msgs,
                    max_silence_sec=inact_sec,
                )
                if msg:
                    _ingest_emit_deep(
                        key_suffix="rest-poller-inactivity",
                        title="Ingest: REST poller hot stream idle",
                        message=msg,
                        component="api.monitoring.ingest.rest_poller",
                    )

    # --- Worker heartbeats (requires Redis key reads)
    heartbeat_missing: list[str] = []
    if redis_ok and r_ops:
        wids = monitoring_probes.pipeline_worker_ids()
        heartbeat_missing = monitoring_probes.missing_worker_heartbeats(r_ops, wids)
        for wid in heartbeat_missing:
            _emit_monitoring_if_cooldown(
                db=db,
                r=r_ops,
                customer_id=cid,
                cooldown_suffix=f"hb:{wid}",
                severity="warning",
                title=f"Monitoring: worker heartbeat missing ({wid})",
                message="Expected Redis key "
                + f"{monitoring_probes.WORKER_HEARTBEAT_KEY_PREFIX}{wid} — "
                "pipeline worker may be down or unable to reach Redis.",
            )
            if (
                wid == "worker-mqtt-bridge"
                and settings.mqtt_bridge_deployed
                and settings.mqtt_ingest_alert_on_broker_down
            ):
                ex = max(60, int(settings.monitoring_deep_cooldown_seconds))
                key = f"monitoring:deep:alert:ingest:mqtt-bridge:{cid}"
                should_emit = True
                if r_ops:
                    try:
                        should_emit = bool(r_ops.set(key, "1", nx=True, ex=ex))
                    except Exception:
                        should_emit = True
                if should_emit:
                    try:
                        emit_alert(
                            db=db,
                            category="ingest",
                            severity="warning",
                            title="Ingest: MQTT bridge worker heartbeat missing",
                            message="worker-mqtt-bridge is not updating Redis heartbeats; "
                            "MQTT payloads may not reach raw.ingest.",
                            customer_id=cid,
                            site_id=None,
                            device_id=None,
                            source_component="api.monitoring.mqtt",
                            source_object_type=None,
                            source_object_id=None,
                            trace_id=None,
                        )
                    except Exception:
                        log.debug("mqtt bridge ingest alert emit failed", exc_info=True)

    # --- Kafka consumer lag
    lag_report: dict = {}
    lag_over = False
    if kafka_ok:
        lag_report = monitoring_probes.pipeline_consumer_lag_report(settings.kafka_bootstrap_servers)
        threshold = max(1, int(settings.monitoring_queue_lag_threshold))
        for _gid, block in lag_report.items():
            lag = block.get("lag_messages")
            if lag is not None and lag > threshold:
                lag_over = True
                break
        if lag_over:
            detail = {k: v.get("lag_messages") for k, v in lag_report.items()}
            _emit_monitoring_if_cooldown(
                db=db,
                r=r_ops,
                customer_id=cid,
                cooldown_suffix="lag",
                severity="warning",
                title="Monitoring: Kafka consumer lag above threshold",
                message=(
                    f"Threshold={threshold} messages; per-group lag: "
                    f"{json.dumps(detail, default=str)}"[:2000]
                ),
            )

    if r_ops is not None and r_ops is not r_cached:
        try:
            r_ops.close()
        except Exception:
            pass

    pipeline_emit(
        log,
        component="api.monitoring",
        action="deep",
        status="ok",
    )
    return {
        "database_ok": database_ok,
        "error": database_error,
        "redis_ok": redis_ok,
        "redis_error": redis_err,
        "kafka_ok": kafka_ok,
        "kafka_error": kafka_err,
        "minio_ok": minio_ok,
        "minio_error": minio_err,
        "mqtt_broker_ok": mqtt_broker_ok,
        "mqtt_broker_error": mqtt_broker_err,
        "worker_heartbeat_missing": heartbeat_missing,
        "consumer_lag": lag_report,
        "queue_lag_threshold": int(settings.monitoring_queue_lag_threshold),
        "queue_lag_above_threshold": lag_over,
    }
