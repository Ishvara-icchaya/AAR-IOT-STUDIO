"""Observational fields for Manage Devices (separate from configuration save)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.raw_data_object import RawDataObject
from app.services import ingress_metrics
from app.services.device_endpoint_connectivity import _rest_mode


def last_raw_ingested_at_iso(db: Session, device_id: UUID) -> str | None:
    ts = db.scalar(
        select(func.max(RawDataObject.ingested_at)).where(RawDataObject.device_id == device_id)
    )
    if ts is None:
        return None
    return ts.isoformat().replace("+00:00", "Z")


def _mqtt_resync_note(interval: int | float | None) -> str:
    try:
        sec = int(interval) if interval is not None else 90
    except (TypeError, ValueError):
        sec = 90
    return (
        "Ingest uses your saved broker (host, port, TLS, auth, client_id) and topic per device. "
        "The bridge opens one MQTT subscriber connection per distinct broker profile and merges topics on that broker. "
        "Optional MQTT_TOPICS env adds patterns on MQTT_BROKER_HOST only. "
        f"Changes apply within ~{sec}s (MQTT_TOPIC_RESYNC_SECONDS) or immediately on worker restart."
    )


def _device_mqtt_ingest_routes(connections: list[Any], device_id: UUID) -> list[dict[str, Any]]:
    """Per-device view of which broker connection carries this device's subscriptions."""
    did = str(device_id)
    out: list[dict[str, Any]] = []
    for c in connections:
        if not isinstance(c, dict):
            continue
        subs_raw = c.get("subscriptions")
        if not isinstance(subs_raw, list):
            continue
        matched: list[dict[str, Any]] = []
        for s in subs_raw:
            if not isinstance(s, dict):
                continue
            sources = s.get("sources")
            if not isinstance(sources, list):
                continue
            if any(
                isinstance(src, dict) and str(src.get("device_id") or "") == did
                for src in sources
            ):
                matched.append(s)
        if matched:
            out.append(
                {
                    "broker_host": c.get("broker_host"),
                    "broker_port": c.get("broker_port"),
                    "use_tls": c.get("use_tls"),
                    "auth_mode": c.get("auth_mode"),
                    "subscriptions": matched,
                }
            )
    return out


def _mqtt_subscription_state(
    *,
    configured_topics: list[str],
    active_subscribed_topics: list[str],
    bridge_snapshot_available: bool,
) -> str:
    if not bridge_snapshot_available:
        return "bridge_unavailable"
    if not configured_topics:
        return "pending_resync"
    try:
        from paho.mqtt.client import topic_matches_sub
    except Exception:
        topic_matches_sub = None  # type: ignore[assignment]

    def matches(ct: str) -> bool:
        if topic_matches_sub is None:
            return ct in active_subscribed_topics
        for sub in active_subscribed_topics:
            try:
                if topic_matches_sub(sub, ct):
                    return True
            except Exception:
                if sub == ct:
                    return True
        return False

    if all(matches(ct) for ct in configured_topics):
        return "synced"
    return "pending_resync"


def build_mqtt_observability_details(config: dict[str, Any], *, device_id: UUID) -> dict[str, Any]:
    topic = config.get("topic")
    topics: list[str] = []
    if isinstance(topic, str) and topic.strip():
        topics = [topic.strip()]
    snap = ingress_metrics.mqtt_bridge_operational_snapshot()
    active = snap.get("subscribed_topics") if isinstance(snap.get("subscribed_topics"), list) else []
    active_s = [str(x) for x in active]
    bridge_ok = bool(snap.get("snapshot_available"))
    last_resync = snap.get("last_resync_at")
    ri = snap.get("resync_interval_seconds")
    ri_int = int(ri) if isinstance(ri, (int, float)) else None
    conns = snap.get("mqtt_bridge_connections")
    conn_list = conns if isinstance(conns, list) else []
    sub_state = _mqtt_subscription_state(
        configured_topics=topics,
        active_subscribed_topics=active_s,
        bridge_snapshot_available=bridge_ok,
    )
    return {
        "configured_topics": topics,
        "active_subscribed_topics": active_s,
        "last_resync_at": last_resync,
        "resync_interval_seconds": ri_int,
        "resync_note": _mqtt_resync_note(ri),
        "bridge_snapshot_available": bridge_ok,
        "subscription_state": sub_state,
        "mqtt_ingest_broker_connection_count": len(conn_list),
        "device_mqtt_ingest_routes": _device_mqtt_ingest_routes(conn_list, device_id),
    }


def build_rest_observability_details(config: dict[str, Any]) -> dict[str, Any]:
    rm = config.get("rest_mode")
    inbound = (config.get("url") or "").strip() or None
    polling = (config.get("polling_url") or "").strip() or None
    return {
        "rest_mode": rm if isinstance(rm, str) else None,
        "inbound_target_summary": (inbound[:200] + "…") if inbound and len(inbound) > 200 else inbound,
        "polling_target_summary": (polling[:200] + "…") if polling and len(polling) > 200 else polling,
        "note": "Inbound REST uses JWT to POST /ingest/raw. Polling is driven by worker-rest-poller when deployed.",
    }


def build_coap_observability_details(config: dict[str, Any]) -> dict[str, Any]:
    h = (config.get("host") or "").strip()
    p = config.get("port", 5683)
    path = (config.get("path") or "").strip() or "/"
    addr = f"{h}:{p}{path}" if h else None
    snap = ingress_metrics.coap_listener_snapshot()
    st = snap.get("status") if snap.get("deployed") else None
    return {
        "configured_address": addr,
        "listener_status": st,
        "snapshot_note": None if snap.get("deployed") else (snap.get("note") if isinstance(snap.get("note"), str) else None),
    }


def build_websocket_observability_details(config: dict[str, Any]) -> dict[str, Any]:
    url = (config.get("url") or "").strip() or None
    summ = (url[:160] + "…") if url and len(url) > 160 else url
    snap = ingress_metrics.websocket_listener_snapshot()
    st = snap.get("status") if snap.get("deployed") else None
    return {
        "configured_url_summary": summ,
        "worker_link_status": st,
        "snapshot_note": None if snap.get("deployed") else (snap.get("note") if isinstance(snap.get("note"), str) else None),
    }


def _logical_protocol(protocol: str) -> str:
    p = (protocol or "").lower()
    if p in ("http", "https"):
        return "rest"
    return p


def _rest_pull_stale_floor_seconds(config: dict[str, Any], polling_interval_column: int) -> int:
    """Minimum silence before REST Pull is treated as stale (HTTP timeout + poll cadence)."""
    try:
        raw_t = config.get("timeout_seconds")
        if raw_t is None:
            raw_t = config.get("timeoutSeconds")
        timeout_s = float(raw_t if raw_t is not None else 30.0)
    except (TypeError, ValueError):
        timeout_s = 30.0
    timeout_s = max(1.0, min(timeout_s, 300.0))
    try:
        raw_p = config.get("polling_interval_seconds")
        if raw_p is None:
            raw_p = config.get("pollingIntervalSeconds")
        poll_s = int(raw_p) if raw_p is not None else int(polling_interval_column)
    except (TypeError, ValueError):
        poll_s = 60
    poll_s = max(5, poll_s)
    return max(int(timeout_s * 3), int(poll_s * 2), 60)


def assess_payload_receipt_timeliness(
    *,
    last_raw_ingested_at: str | None,
    late_threshold_seconds: int,
    logical_protocol: str,
    config: dict[str, Any],
    polling_interval_column: int,
) -> dict[str, Any]:
    """Classify latest archived raw age vs device late threshold (and REST Pull cadence when applicable)."""
    late = max(1, int(late_threshold_seconds or 120))
    logical = (logical_protocol or "").strip().lower()
    rm = _rest_mode(config) if logical == "rest" else ""
    if logical == "rest" and rm == "polling":
        threshold = max(late, _rest_pull_stale_floor_seconds(config, polling_interval_column))
    else:
        threshold = late

    if not last_raw_ingested_at or not str(last_raw_ingested_at).strip():
        return {
            "status": "none",
            "age_seconds": None,
            "threshold_seconds": threshold,
        }
    try:
        raw = str(last_raw_ingested_at).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age = max(0.0, (datetime.now(timezone.utc) - dt).total_seconds())
    except ValueError:
        return {
            "status": "none",
            "age_seconds": None,
            "threshold_seconds": threshold,
        }
    age_i = int(age)
    if age > threshold:
        return {
            "status": "stale",
            "age_seconds": age_i,
            "threshold_seconds": threshold,
        }
    return {
        "status": "fresh",
        "age_seconds": age_i,
        "threshold_seconds": threshold,
    }


def build_observability(
    db: Session,
    *,
    device_id: UUID,
    protocol: str,
    config: dict[str, Any],
    polling_interval_seconds: int = 60,
) -> dict[str, Any]:
    last_raw = last_raw_ingested_at_iso(db, device_id)
    logical = _logical_protocol(protocol)
    details: dict[str, Any] | None = None
    if logical == "mqtt":
        details = build_mqtt_observability_details(config, device_id=device_id)
    elif logical == "rest":
        details = build_rest_observability_details(config)
    elif logical == "coap":
        details = build_coap_observability_details(config)
    elif logical == "websocket":
        details = build_websocket_observability_details(config)
    else:
        details = {"note": f"No protocol-specific observability for {protocol!r}."}

    device = db.get(Device, device_id)
    late_thr = int(getattr(device, "late_threshold_seconds", None) or 120) if device else 120
    receipt = assess_payload_receipt_timeliness(
        last_raw_ingested_at=last_raw,
        late_threshold_seconds=late_thr,
        logical_protocol=logical,
        config=config if isinstance(config, dict) else {},
        polling_interval_column=polling_interval_seconds,
    )

    return {
        "last_raw_ingested_at": last_raw,
        "protocol": logical,
        "details": details or {},
        "payload_receipt_status": receipt["status"],
        "payload_age_seconds": receipt["age_seconds"],
        "payload_receipt_threshold_seconds": receipt["threshold_seconds"],
    }
