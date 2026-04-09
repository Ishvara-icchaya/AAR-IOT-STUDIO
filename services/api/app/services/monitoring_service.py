"""Orchestration for /monitoring/* read APIs (no alert emission)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.alert import Alert
from app.services import monitoring_probes
from app.services.monitoring_ai_service import build_ai_payload
from app.services.monitoring_collectors import (
    host_memory_percent,
    monitoring_redis_client,
    probe_ollama,
    probe_timescale,
    self_process_resources,
)
from app.services.monitoring_queue_service import build_queue_rows
from app.services import ingress_metrics
from app.services.monitoring_storage_service import build_storage_rows

log = logging.getLogger(__name__)

SERVICE_DEFINITIONS_CORE: tuple[dict[str, str], ...] = (
    {"service_name": "api", "service_type": "fastapi"},
    {"service_name": "worker-ingest", "service_type": "worker"},
    {"service_name": "worker-scrubber", "service_type": "worker"},
    {"service_name": "worker-workflow", "service_type": "worker"},
    {"service_name": "worker-publish", "service_type": "worker"},
    {"service_name": "worker-ai", "service_type": "worker"},
    {"service_name": "scheduler", "service_type": "scheduler"},
    {"service_name": "ollama", "service_type": "llm"},
)


def iter_service_definitions() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for d in SERVICE_DEFINITIONS_CORE:
        out.append(d)
        if d["service_name"] == "api":
            out.append({"service_name": "rest-ingest", "service_type": "rest_ingest"})
            if settings.rest_poller_deployed:
                out.append({"service_name": "rest-poller", "service_type": "rest_poller"})
        if d["service_name"] == "worker-ingest" and settings.mqtt_bridge_deployed:
            out.append({"service_name": "worker-mqtt-bridge", "service_type": "worker"})
    if settings.platform_mqtt_broker_enabled:
        out.append({"service_name": "mosquitto", "service_type": "mqtt_broker"})
    if settings.coap_listener_deployed:
        out.append({"service_name": "coap-listener", "service_type": "coap_listener"})
    if settings.websocket_ingest_deployed:
        out.append({"service_name": "websocket-ingest", "service_type": "websocket_ingest"})
    return out


# Stable ordering: ingress adapters together, then data-plane workers, then aux.
_MONITORING_SERVICE_ORDER: tuple[str, ...] = (
    "api",
    "rest-ingest",
    "rest-poller",
    "coap-listener",
    "websocket-ingest",
    "mosquitto",
    "worker-mqtt-bridge",
    "worker-ingest",
    "worker-scrubber",
    "worker-workflow",
    "worker-publish",
    "worker-ai",
    "scheduler",
    "ollama",
)


def _monitoring_service_sort_key(service_name: str) -> tuple[int, str]:
    try:
        idx = _MONITORING_SERVICE_ORDER.index(service_name)
    except ValueError:
        return (len(_MONITORING_SERVICE_ORDER), service_name)
    return (idx, service_name)


def heartbeat_service_names() -> frozenset[str]:
    names = [
        "worker-ingest",
        "worker-scrubber",
        "worker-workflow",
        "worker-publish",
        "worker-ai",
        "scheduler",
    ]
    if settings.mqtt_bridge_deployed:
        names.append("worker-mqtt-bridge")
    if settings.coap_listener_deployed:
        names.append("worker-coap-listener")
    if settings.websocket_ingest_deployed:
        names.append("worker-websocket-ingest")
    if settings.rest_poller_deployed:
        names.append("worker-rest-poller")
    return frozenset(names)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ingress_adapter_detail(snap: dict[str, Any]) -> str | None:
    if not snap:
        return None
    if snap.get("note") and not snap.get("deployed"):
        return str(snap["note"])[:220]
    rate_bits: list[str] = []
    st = snap.get("status")
    if isinstance(st, str) and st.strip():
        rate_bits.append(f"link {st.strip()[:32]}")
    m5 = snap.get("messages_last_5m")
    if m5 is not None:
        rate_bits.append(f"5m rate {m5}")
    mc = snap.get("message_count")
    if mc is not None:
        rate_bits.append(f"total {mc}")
    ec = snap.get("error_count")
    if ec is not None:
        rate_bits.append(f"errors {ec}")
    lp = snap.get("last_payload_at") or snap.get("last_message_at")
    if isinstance(lp, str) and lp:
        rate_bits.append(f"last payload {lp[:22]}")
    pt = snap.get("poll_total")
    pf = snap.get("poll_fail_total")
    if pt is not None:
        rate_bits.append(f"polls {pt}")
    if pf is not None:
        rate_bits.append(f"poll fail {pf}")
    lpp = snap.get("last_poll_at")
    if isinstance(lpp, str) and lpp:
        rate_bits.append(f"last poll {lpp[:22]}")
    line_a = " · ".join(rate_bits) if rate_bits else None
    le = snap.get("last_error")
    err_line = None
    if isinstance(le, str) and le.strip():
        err_line = f"Last error: {le.strip()[:160]}"
    if line_a and err_line:
        return f"{line_a}\n{err_line}"
    return line_a or err_line


def _status_label(ok: bool) -> str:
    return "healthy" if ok else "critical"


def _rollup_worker_status(heartbeat_missing: list[str], redis_ok: bool) -> str:
    if not redis_ok:
        return "unknown"
    if not heartbeat_missing:
        return "healthy"
    return "warning"


def _heartbeat_role_status(state: dict[str, Any], worker_id: str) -> str:
    if not state["redis_ok"]:
        return "unknown"
    return "healthy" if worker_id not in state["heartbeat_missing"] else "warning"


def _total_queue_lag(lag_report: dict[str, Any]) -> int:
    t = 0
    for _gid, block in lag_report.items():
        v = block.get("lag_messages")
        if isinstance(v, int):
            t += v
    return t


def collect_platform_state(db: Session) -> dict[str, Any]:
    """Run probes once; used by multiple monitoring endpoints in the same process (no request-level cache)."""
    postgres_ok = True
    postgres_err: str | None = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        postgres_ok = False
        postgres_err = str(e)[:500]

    redis_ok, redis_err = monitoring_probes.probe_redis(settings.redis_url)
    kafka_ok, kafka_err = monitoring_probes.probe_kafka(settings.kafka_bootstrap_servers)
    minio_ok, minio_err = monitoring_probes.probe_minio()
    timescale_ok, timescale_err = probe_timescale()
    ollama_ok, ollama_err, ollama_json = probe_ollama()
    cpu_pct, mem_mb = self_process_resources()
    mem_pct_host = host_memory_percent()

    lag_report: dict[str, Any] = {}
    if kafka_ok:
        lag_report = monitoring_probes.pipeline_consumer_lag_report(settings.kafka_bootstrap_servers)

    heartbeat_missing: list[str] = []
    if redis_ok:
        with monitoring_redis_client() as r:
            if r is not None:
                heartbeat_missing = monitoring_probes.missing_worker_heartbeats(
                    r, monitoring_probes.pipeline_worker_ids()
                )

    mqtt_broker_tcp_ok = True
    mqtt_broker_tcp_err: str | None = None
    if settings.platform_mqtt_broker_enabled:
        mqtt_broker_tcp_ok, mqtt_broker_tcp_err = monitoring_probes.probe_mqtt_tcp(
            settings.mqtt_broker_probe_host,
            settings.mqtt_broker_probe_port,
        )

    mqtt_last_ingest_iso: str | None = None
    if redis_ok:
        with monitoring_redis_client() as r:
            if r is not None:
                try:
                    raw_ts = r.get(monitoring_probes.INGRESS_LAST_INGEST_MQTT_KEY)
                    if not raw_ts:
                        raw_ts = r.get(monitoring_probes.LEGACY_MQTT_BRIDGE_LAST_INGEST_REDIS_KEY)
                    if raw_ts:
                        mqtt_last_ingest_iso = datetime.fromtimestamp(
                            float(raw_ts), tz=timezone.utc
                        ).isoformat().replace("+00:00", "Z")
                except (TypeError, ValueError, OSError):
                    pass

    rest_ingest_metrics = ingress_metrics.get_rest_ingest_snapshot()
    coap_listener_snapshot = ingress_metrics.coap_listener_snapshot()
    websocket_listener_snapshot = ingress_metrics.websocket_listener_snapshot()
    rest_poller_snapshot = ingress_metrics.rest_poller_snapshot()

    return {
        "postgres_ok": postgres_ok,
        "postgres_err": postgres_err,
        "redis_ok": redis_ok,
        "redis_err": redis_err,
        "kafka_ok": kafka_ok,
        "kafka_err": kafka_err,
        "minio_ok": minio_ok,
        "minio_err": minio_err,
        "timescale_ok": timescale_ok,
        "timescale_err": timescale_err,
        "ollama_ok": ollama_ok,
        "ollama_err": ollama_err,
        "ollama_json": ollama_json,
        "lag_report": lag_report,
        "cpu_percent": cpu_pct,
        "memory_mb_api": mem_mb,
        "memory_percent_host": mem_pct_host,
        "heartbeat_missing": heartbeat_missing,
        "mqtt_broker_tcp_ok": mqtt_broker_tcp_ok,
        "mqtt_broker_tcp_err": mqtt_broker_tcp_err,
        "mqtt_last_ingest_iso": mqtt_last_ingest_iso,
        "rest_ingest_metrics": rest_ingest_metrics,
        "coap_listener_snapshot": coap_listener_snapshot,
        "websocket_listener_snapshot": websocket_listener_snapshot,
        "rest_poller_snapshot": rest_poller_snapshot,
    }


def _active_alerts_count(db: Session, customer_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(Alert)
            .where(Alert.customer_id == customer_id, Alert.acknowledged.is_(False))
        )
        or 0
    )


def _recent_incidents(db: Session, customer_id: uuid.UUID, limit: int = 15) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(Alert)
        .where(Alert.customer_id == customer_id)
        .order_by(Alert.created_at.desc())
        .limit(limit)
    ).all()
    out: list[dict[str, Any]] = []
    for a in rows:
        ts = a.created_at
        t_s = ts.isoformat().replace("+00:00", "Z") if ts else _now_iso()
        comp = a.source_component or (a.category or "platform")
        out.append(
            {
                "alert_id": str(a.id),
                "time": t_s,
                "component": comp,
                "severity": (a.severity or "info").lower(),
                "message": (a.title + (f" — {a.message}" if a.message else ""))[:500],
            }
        )
    return out


def build_overview(db: Session, customer_id: uuid.UUID, state: dict[str, Any]) -> dict[str, Any]:
    worker_st = _rollup_worker_status(state["heartbeat_missing"], state["redis_ok"])
    minio_st = _status_label(state["minio_ok"])

    lag_sum = _total_queue_lag(state["lag_report"])
    threshold = max(1, int(settings.monitoring_queue_lag_threshold))
    queue_st = "healthy"
    if lag_sum > threshold:
        queue_st = "warning"
    if lag_sum > threshold * 5:
        queue_st = "critical"

    summary = {
        "api_status": "healthy" if state["postgres_ok"] and state["redis_ok"] else "warning",
        "kafka_status": _status_label(state["kafka_ok"]),
        "redis_status": _status_label(state["redis_ok"]),
        "minio_status": minio_st,
        "postgres_status": _status_label(state["postgres_ok"]),
        "timescale_status": _status_label(state["timescale_ok"]),
        "scheduler_status": (
            "healthy"
            if state["redis_ok"] and "scheduler" not in state["heartbeat_missing"]
            else ("unknown" if not state["redis_ok"] else "warning")
        ),
        "worker_status": worker_st,
        "scrubber_worker_status": _heartbeat_role_status(state, "worker-scrubber"),
        "workflow_worker_status": _heartbeat_role_status(state, "worker-workflow"),
        "publish_worker_status": _heartbeat_role_status(state, "worker-publish"),
        "ai_worker_status": _heartbeat_role_status(state, "worker-ai"),
        "ingest_worker_status": _heartbeat_role_status(state, "worker-ingest"),
        "active_alerts": _active_alerts_count(db, customer_id),
        "cpu_percent": state["cpu_percent"],
        "memory_percent": state.get("memory_percent_host"),
        "websocket_connections": None,
        "queue_lag_messages": lag_sum,
        "queue_status": queue_st,
        "load_balancer_status": "unknown",
        "ollama_status": "healthy" if state["ollama_ok"] else "warning",
        "mqtt_broker_status": (
            _status_label(state["mqtt_broker_tcp_ok"])
            if settings.platform_mqtt_broker_enabled
            else None
        ),
        "mqtt_bridge_status": (
            _heartbeat_role_status(state, "worker-mqtt-bridge")
            if settings.mqtt_bridge_deployed
            else None
        ),
        "mqtt_broker_listen_port": (
            int(settings.mqtt_broker_probe_port) if settings.platform_mqtt_broker_enabled else None
        ),
        "mqtt_last_ingest_at": state.get("mqtt_last_ingest_iso"),
        "rest_ingest_status": _rest_ingest_status_label(state),
        "coap_listener_status": (
            _coap_listener_status_label(state) if settings.coap_listener_deployed else None
        ),
        "websocket_ingest_status": (
            _websocket_ingest_status_label(state) if settings.websocket_ingest_deployed else None
        ),
        "rest_poller_status": _rest_poller_status_label(state) if settings.rest_poller_deployed else None,
    }

    if not state["postgres_ok"]:
        summary["api_status"] = "critical"

    return {
        "summary": summary,
        "recent_incidents": _recent_incidents(db, customer_id),
    }


def _rest_ingest_status_label(state: dict[str, Any]) -> str:
    m = state.get("rest_ingest_metrics") or {}
    if not state["postgres_ok"]:
        return "critical"
    if not m.get("redis_available"):
        return "unknown"
    fails = m.get("failures_last_15m")
    thr = max(3, int(settings.ingest_rest_failures_alert_threshold_15m))
    if isinstance(fails, int) and fails >= thr:
        return "critical"
    if isinstance(fails, int) and fails >= max(1, thr // 3):
        return "warning"
    return "healthy"


def _coap_listener_status_label(state: dict[str, Any]) -> str:
    if not settings.coap_listener_deployed:
        return "unknown"
    if not state.get("postgres_ok"):
        return "critical"
    if not state["redis_ok"]:
        return "unknown"
    if "worker-coap-listener" in state.get("heartbeat_missing", []):
        return "critical"
    snap = state.get("coap_listener_snapshot") or {}
    if not snap.get("deployed"):
        return "warning"
    return "healthy"


def _websocket_ingest_status_label(state: dict[str, Any]) -> str:
    if not settings.websocket_ingest_deployed:
        return "unknown"
    if not state.get("postgres_ok"):
        return "critical"
    if not state["redis_ok"]:
        return "unknown"
    if "worker-websocket-ingest" in state.get("heartbeat_missing", []):
        return "critical"
    snap = state.get("websocket_listener_snapshot") or {}
    if not snap.get("deployed"):
        return "warning"
    return "healthy"


def _rest_poller_status_label(state: dict[str, Any]) -> str:
    if not settings.rest_poller_deployed:
        return "unknown"
    if not state.get("postgres_ok"):
        return "critical"
    if not state["redis_ok"]:
        return "unknown"
    if "worker-rest-poller" in state.get("heartbeat_missing", []):
        return "critical"
    snap = state.get("rest_poller_snapshot") or {}
    if not snap.get("deployed"):
        return "warning"
    try:
        pt = int(snap.get("poll_total") or 0)
        pf = int(snap.get("poll_fail_total") or 0)
    except (TypeError, ValueError):
        return "healthy"
    if pt >= 30 and pf * 2 >= pt:
        return "warning"
    return "healthy"


def _heartbeat_last_seen(r: Any | None, service_name: str) -> str | None:
    if r is None or service_name not in heartbeat_service_names():
        return None
    try:
        raw = r.get(monitoring_probes.WORKER_HEARTBEAT_KEY_PREFIX + service_name)
        if not raw:
            return None
        ts = int(raw)
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def _service_row(
    *,
    name: str,
    typ: str,
    state: dict[str, Any],
    r: Any | None,
    db: Session,
    customer_id: uuid.UUID,
) -> dict[str, Any]:
    st = "unknown"
    last_seen: str | None = None
    cpu: float | None = None
    mem: float | None = None
    alerts = 0

    if name == "api":
        st = "healthy" if state["postgres_ok"] and state["redis_ok"] and state["kafka_ok"] else "warning"
        if not state["postgres_ok"]:
            st = "critical"
        last_seen = _now_iso()
        cpu = state["cpu_percent"]
        mem = state["memory_mb_api"]
    elif name == "ollama":
        st = "healthy" if state["ollama_ok"] else "critical"
        last_seen = _now_iso() if state["ollama_ok"] else None
    elif name == "rest-ingest":
        m = state.get("rest_ingest_metrics") or {}
        st = _rest_ingest_status_label(state)
        ls = m.get("last_success_at")
        last_seen = ls if isinstance(ls, str) else None
    elif name == "coap-listener":
        snap = state.get("coap_listener_snapshot") or {}
        if not settings.coap_listener_deployed:
            st = "unknown"
        elif "worker-coap-listener" in state.get("heartbeat_missing", []):
            st = "critical"
        elif snap.get("deployed"):
            st = "healthy"
        else:
            st = "warning"
        lm = snap.get("last_payload_at") or snap.get("last_message_at")
        last_seen = lm if isinstance(lm, str) else None
        if last_seen is None and r is not None and settings.coap_listener_deployed:
            last_seen = _heartbeat_last_seen(r, "worker-coap-listener")
    elif name == "websocket-ingest":
        snap = state.get("websocket_listener_snapshot") or {}
        if not settings.websocket_ingest_deployed:
            st = "unknown"
        elif "worker-websocket-ingest" in state.get("heartbeat_missing", []):
            st = "critical"
        elif snap.get("deployed"):
            st = "healthy"
        else:
            st = "warning"
        lm = snap.get("last_payload_at") or snap.get("last_message_at")
        last_seen = lm if isinstance(lm, str) else None
        if last_seen is None and r is not None and settings.websocket_ingest_deployed:
            last_seen = _heartbeat_last_seen(r, "worker-websocket-ingest")
    elif name == "rest-poller":
        snap = state.get("rest_poller_snapshot") or {}
        if not settings.rest_poller_deployed:
            st = "unknown"
        elif "worker-rest-poller" in state.get("heartbeat_missing", []):
            st = "critical"
        elif snap.get("deployed"):
            st = "healthy"
        else:
            st = "warning"
        lm = snap.get("last_payload_at") or snap.get("last_message_at")
        last_seen = lm if isinstance(lm, str) else None
        if last_seen is None and r is not None and settings.rest_poller_deployed:
            last_seen = _heartbeat_last_seen(r, "worker-rest-poller")
    elif name in heartbeat_service_names():
        last_seen = _heartbeat_last_seen(r, name)
        if not state["redis_ok"]:
            st = "unknown"
        elif name in state["heartbeat_missing"]:
            st = "warning"
        else:
            st = "healthy"
    elif name == "mosquitto":
        if not settings.platform_mqtt_broker_enabled:
            st = "unknown"
            last_seen = None
        elif state.get("mqtt_broker_tcp_ok"):
            st = "healthy"
            last_seen = _now_iso()
        else:
            st = "critical"
            last_seen = None
    else:
        st = "unknown"

    alerts = int(
        db.scalar(
            select(func.count())
            .select_from(Alert)
            .where(
                Alert.customer_id == customer_id,
                Alert.acknowledged.is_(False),
                Alert.source_component.ilike(f"%{name}%"),
            )
        )
        or 0
    )
    err_alerts = int(
        db.scalar(
            select(func.count())
            .select_from(Alert)
            .where(
                Alert.customer_id == customer_id,
                Alert.acknowledged.is_(False),
                Alert.severity.in_(("warning", "critical")),
                Alert.source_component.ilike(f"%{name}%"),
            )
        )
        or 0
    )

    row: dict[str, Any] = {
        "service_name": name,
        "service_type": typ,
        "status": st,
        "last_seen": last_seen,
        "cpu_percent": cpu,
        "memory_mb": mem,
        "error_count": err_alerts,
        "active_alerts": alerts,
        "mqtt_broker_listen_port": None,
        "mqtt_connection_state": None,
        "last_ingest_message_at": None,
        "ingress_detail": None,
    }
    if name == "mosquitto":
        row["mqtt_broker_listen_port"] = int(settings.mqtt_broker_probe_port)
        if not settings.platform_mqtt_broker_enabled:
            row["mqtt_connection_state"] = "n/a"
        elif state.get("mqtt_broker_tcp_ok"):
            row["mqtt_connection_state"] = "reachable"
        else:
            row["mqtt_connection_state"] = "unreachable"
    elif name == "worker-mqtt-bridge":
        row["last_ingest_message_at"] = state.get("mqtt_last_ingest_iso")
    elif name == "rest-ingest":
        m = state.get("rest_ingest_metrics") or {}
        ok5 = m.get("ok_last_5m")
        fl = m.get("failures_last_15m")
        lat = m.get("last_latency_ms")
        le = m.get("last_error")
        rate_bits = []
        if ok5 is not None:
            rate_bits.append(f"5m rate ~{ok5}")
        if fl is not None:
            rate_bits.append(f"fail ~15m {fl}")
        if lat is not None:
            rate_bits.append(f"latency_ms {lat}")
        line_a = " · ".join(rate_bits) if rate_bits else None
        err_line = (
            f"Last error: {str(le).strip()[:160]}" if isinstance(le, str) and le.strip() else None
        )
        if line_a and err_line:
            row["ingress_detail"] = f"{line_a}\n{err_line}"
        else:
            row["ingress_detail"] = line_a or err_line
    elif name == "coap-listener":
        snap = state.get("coap_listener_snapshot") or {}
        row["ingress_detail"] = _ingress_adapter_detail(snap)
    elif name == "websocket-ingest":
        snap = state.get("websocket_listener_snapshot") or {}
        row["ingress_detail"] = _ingress_adapter_detail(snap)
    elif name == "rest-poller":
        snap = state.get("rest_poller_snapshot") or {}
        row["ingress_detail"] = _ingress_adapter_detail(snap)
    return row


def build_services(db: Session, customer_id: uuid.UUID, state: dict[str, Any]) -> list[dict[str, Any]]:
    defs = sorted(
        iter_service_definitions(),
        key=lambda d: _monitoring_service_sort_key(d["service_name"]),
    )
    with monitoring_redis_client() as r:
        return [
            _service_row(
                name=d["service_name"],
                typ=d["service_type"],
                state=state,
                r=r if state["redis_ok"] else None,
                db=db,
                customer_id=customer_id,
            )
            for d in defs
        ]


def build_resources(state: dict[str, Any]) -> list[dict[str, Any]]:
    cpu = state["cpu_percent"]
    mem = state["memory_mb_api"]
    rows = [
        {
            "component": "api",
            "cpu_percent": cpu,
            "memory_mb": mem,
            "disk_io_mb_s": None,
            "network_io_mb_s": None,
            "status": "healthy" if state["postgres_ok"] else "critical",
        },
        {
            "component": "postgres",
            "cpu_percent": None,
            "memory_mb": None,
            "disk_io_mb_s": None,
            "network_io_mb_s": None,
            "status": _status_label(state["postgres_ok"]),
        },
        {
            "component": "timescaledb",
            "cpu_percent": None,
            "memory_mb": None,
            "disk_io_mb_s": None,
            "network_io_mb_s": None,
            "status": _status_label(state["timescale_ok"]),
        },
        {
            "component": "redis",
            "cpu_percent": None,
            "memory_mb": None,
            "disk_io_mb_s": None,
            "network_io_mb_s": None,
            "status": _status_label(state["redis_ok"]),
        },
        {
            "component": "minio",
            "cpu_percent": None,
            "memory_mb": None,
            "disk_io_mb_s": None,
            "network_io_mb_s": None,
            "status": _status_label(state["minio_ok"]),
        },
    ]
    workers = [
        "worker-ingest",
        "worker-scrubber",
        "worker-workflow",
        "worker-publish",
        "worker-ai",
        "scheduler",
    ]
    if settings.mqtt_bridge_deployed:
        workers.insert(1, "worker-mqtt-bridge")
    if settings.coap_listener_deployed:
        workers.append("worker-coap-listener")
    if settings.websocket_ingest_deployed:
        workers.append("worker-websocket-ingest")
    if settings.rest_poller_deployed:
        workers.append("worker-rest-poller")
    for w in workers:
        st = "healthy"
        if not state["redis_ok"]:
            st = "unknown"
        elif w in state["heartbeat_missing"]:
            st = "warning"
        rows.append(
            {
                "component": w,
                "cpu_percent": None,
                "memory_mb": None,
                "disk_io_mb_s": None,
                "network_io_mb_s": None,
                "status": st,
            }
        )
    if settings.platform_mqtt_broker_enabled:
        mb = "healthy" if state.get("mqtt_broker_tcp_ok") else "critical"
        rows.append(
            {
                "component": "mosquitto",
                "cpu_percent": None,
                "memory_mb": None,
                "disk_io_mb_s": None,
                "network_io_mb_s": None,
                "status": mb,
            }
        )
    return rows


def build_service_detail(
    service_name: str,
    db: Session,
    customer_id: uuid.UUID,
    state: dict[str, Any],
) -> dict[str, Any] | None:
    defs = iter_service_definitions()
    names = {d["service_name"] for d in defs}
    if service_name not in names:
        return None
    d = next(x for x in defs if x["service_name"] == service_name)
    with monitoring_redis_client() as r:
        row = _service_row(
            name=d["service_name"],
            typ=d["service_type"],
            state=state,
            r=r if state["redis_ok"] else None,
            db=db,
            customer_id=customer_id,
        )
        recent = db.scalars(
            select(Alert)
            .where(Alert.customer_id == customer_id, Alert.source_component.ilike(f"%{service_name}%"))
            .order_by(Alert.created_at.desc())
            .limit(20)
        ).all()
        recent_alerts = [
            {
                "alert_id": str(a.id),
                "time": (a.created_at.isoformat().replace("+00:00", "Z") if a.created_at else _now_iso()),
                "severity": (a.severity or "info").lower(),
                "message": (a.title + (f" — {a.message}" if a.message else ""))[:500],
            }
            for a in recent
        ]
        hb_age: int | None = None
        if row.get("last_seen"):
            try:
                raw = str(row["last_seen"]).replace("Z", "+00:00")
                if raw.endswith("+00:00") or "+" in raw[-6:]:
                    dt = datetime.fromisoformat(raw)
                else:
                    dt = datetime.fromisoformat(raw).replace(tzinfo=timezone.utc)
                hb_age = max(0, int((datetime.now(timezone.utc) - dt).total_seconds()))
            except Exception:
                hb_age = None
        metrics: dict[str, Any] = {}
        if row.get("cpu_percent") is not None:
            metrics["cpu_percent"] = row["cpu_percent"]
        if row.get("memory_mb") is not None:
            metrics["memory_mb"] = row["memory_mb"]
        if hb_age is not None:
            metrics["heartbeat_age_sec"] = hb_age
        if row.get("mqtt_broker_listen_port") is not None:
            metrics["mqtt_listen_port"] = row["mqtt_broker_listen_port"]
        if row.get("mqtt_connection_state"):
            metrics["mqtt_connection_state"] = row["mqtt_connection_state"]
        if row.get("last_ingest_message_at"):
            metrics["last_ingest_message_at"] = row["last_ingest_message_at"]
        if service_name == "mosquitto":
            metrics["probe_target"] = f"{settings.mqtt_broker_probe_host}:{settings.mqtt_broker_probe_port}"
        if service_name == "rest-ingest":
            rm = state.get("rest_ingest_metrics") or {}
            for k in (
                "success_total",
                "fail_total",
                "last_success_at",
                "last_fail_at",
                "last_latency_ms",
                "failures_last_15m",
                "ok_last_5m",
                "last_error",
                "last_fail_kind",
            ):
                if rm.get(k) is not None:
                    metrics[k] = rm[k]
        if service_name == "coap-listener":
            snap = state.get("coap_listener_snapshot") or {}
            for k in (
                "status",
                "message_count",
                "error_count",
                "last_message_at",
                "last_payload_at",
                "messages_last_5m",
                "last_error",
            ):
                if snap.get(k) is not None:
                    metrics[k] = snap[k]
        if service_name == "websocket-ingest":
            snap = state.get("websocket_listener_snapshot") or {}
            for k in (
                "status",
                "message_count",
                "error_count",
                "last_message_at",
                "last_payload_at",
                "messages_last_5m",
                "last_error",
            ):
                if snap.get(k) is not None:
                    metrics[k] = snap[k]
        if service_name == "rest-poller":
            snap = state.get("rest_poller_snapshot") or {}
            for k in (
                "status",
                "message_count",
                "error_count",
                "last_message_at",
                "last_payload_at",
                "messages_last_5m",
                "last_error",
                "poll_total",
                "poll_fail_total",
                "last_poll_at",
            ):
                if snap.get(k) is not None:
                    metrics[k] = snap[k]
        return {
            **row,
            "recent_alerts": recent_alerts,
            "recent_issues": recent_alerts,
            "recent_metrics": metrics,
            "service_last_seen_key": f"monitoring:service:last_seen:{service_name}",
            "heartbeat_key": (monitoring_probes.WORKER_HEARTBEAT_KEY_PREFIX + service_name)
            if service_name in heartbeat_service_names()
            else None,
        }


def build_queues_payload(state: dict[str, Any]) -> list[dict[str, Any]]:
    with monitoring_redis_client() as r:
        return build_queue_rows(
            kafka_ok=state["kafka_ok"],
            lag_report=state["lag_report"],
            r=r if state["redis_ok"] else None,
            worker_ids=monitoring_probes.pipeline_worker_ids(),
            lag_threshold=max(1, int(settings.monitoring_queue_lag_threshold)),
        )


def build_storage_payload(db: Session, state: dict[str, Any]) -> list[dict[str, Any]]:
    with monitoring_redis_client() as r:
        return build_storage_rows(
            db=db,
            redis_client=r if state["redis_ok"] else None,
            postgres_ok=state["postgres_ok"],
            timescale_ok=state["timescale_ok"],
            redis_ok=state["redis_ok"],
            minio_ok=state["minio_ok"],
        )


def build_ai_monitoring_payload(
    state: dict[str, Any],
    *,
    db: Session | None = None,
    customer_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    with monitoring_redis_client() as r:
        return build_ai_payload(
            r=r if state["redis_ok"] else None,
            ollama_ok=state["ollama_ok"],
            ollama_json=state["ollama_json"],
            ollama_err=state["ollama_err"],
            db=db,
            customer_id=customer_id,
        )
