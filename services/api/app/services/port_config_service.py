"""Per-customer logical platform port rows + settings."""

from __future__ import annotations

import socket
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings as app_settings
from app.models.platform_port import PlatformPort, PlatformPortSettings
from app.schemas.platform_port import (
    MqttIngestDeploymentRead,
    MqttIngestTenantRead,
    PlatformPortRead,
    PlatformPortsConfigRead,
    PlatformPortsConfigUpdate,
    PlatformPortsTestResponse,
    PortProbeResult,
    port_read_from_model,
)

_CANONICAL_PLATFORM_PORT_SPECS: list[dict[str, Any]] = [
    {"service_name": "api", "protocol": "http", "host": "0.0.0.0", "port": 8000, "enabled": True},
    {"service_name": "mqtt_broker", "protocol": "mqtt", "host": "0.0.0.0", "port": 1883, "enabled": True},
    {"service_name": "kafka", "protocol": "tcp", "host": "0.0.0.0", "port": 9092, "enabled": True},
    {"service_name": "websocket", "protocol": "ws", "host": "0.0.0.0", "port": 8001, "enabled": True},
    {"service_name": "coap_listener", "protocol": "coap", "host": "0.0.0.0", "port": 5683, "enabled": False},
    {"service_name": "minio", "protocol": "http", "host": "0.0.0.0", "port": 9000, "enabled": True},
    {"service_name": "ollama", "protocol": "http", "host": "127.0.0.1", "port": 11434, "enabled": True},
]


def _ensure_default_ports(db: Session, customer_id: uuid.UUID) -> None:
    """Seed full canonical port matrix for new tenants; add missing rows for existing tenants."""
    existing = list(db.scalars(select(PlatformPort).where(PlatformPort.customer_id == customer_id)).all())
    if not existing:
        for s in _CANONICAL_PLATFORM_PORT_SPECS:
            db.add(
                PlatformPort(
                    id=uuid.uuid4(),
                    customer_id=customer_id,
                    service_name=s["service_name"],
                    protocol=s["protocol"],
                    host=s["host"],
                    port=s["port"],
                    enabled=s["enabled"],
                )
            )
        db.commit()
        return
    by_name = {p.service_name: p for p in existing}
    added = False
    for s in _CANONICAL_PLATFORM_PORT_SPECS:
        if s["service_name"] in by_name:
            continue
        db.add(
            PlatformPort(
                id=uuid.uuid4(),
                customer_id=customer_id,
                service_name=s["service_name"],
                protocol=s["protocol"],
                host=s["host"],
                port=s["port"],
                enabled=s["enabled"],
            )
        )
        added = True
    if added:
        db.commit()


def _ensure_settings(db: Session, customer_id: uuid.UUID) -> PlatformPortSettings:
    row = db.scalars(
        select(PlatformPortSettings).where(PlatformPortSettings.customer_id == customer_id)
    ).first()
    if row:
        return row
    row = PlatformPortSettings(
        id=uuid.uuid4(),
        customer_id=customer_id,
        default_rest_publish_host="0.0.0.0",
        default_rest_publish_port=8000,
        default_mqtt_publish_host="0.0.0.0",
        default_mqtt_publish_port=1883,
        mqtt_ingest_broker_mode="internal",
        mqtt_ingest_external_broker_host=None,
        mqtt_ingest_external_broker_port=None,
        mqtt_ingest_subscribe_topic=None,
        mqtt_ingest_qos=0,
        allow_external_access=False,
        restrict_to_localhost=False,
        enable_tls=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _connectable_host(host: str) -> str:
    h = (host or "").strip()
    if h in ("0.0.0.0", "::", ""):
        return "127.0.0.1"
    return h


def get_publish_target_defaults(db: Session, customer_id: uuid.UUID) -> tuple[dict[str, Any], dict[str, Any]]:
    """REST/MQTT target_config_json shapes from platform_port_settings (tenant defaults)."""
    st = _ensure_settings(db, customer_id)
    rh = st.default_rest_publish_host or "0.0.0.0"
    rp = st.default_rest_publish_port or 8000
    mh = st.default_mqtt_publish_host or "0.0.0.0"
    mp = st.default_mqtt_publish_port or 1883
    rest = {
        "url": f"http://{_connectable_host(rh)}:{int(rp)}/ingest/hook",
        "method": "POST",
        "timeout_seconds": 30,
    }
    mqtt = {
        "host": _connectable_host(mh),
        "port": int(mp),
        "topic": "aar/published/default",
        "qos": 1,
    }
    return rest, mqtt


def _mqtt_tenant_read(st: PlatformPortSettings) -> MqttIngestTenantRead:
    mode = (st.mqtt_ingest_broker_mode or "internal").strip().lower()
    if mode not in ("internal", "external"):
        mode = "internal"
    qos = int(st.mqtt_ingest_qos or 0)
    qos = max(0, min(2, qos))
    return MqttIngestTenantRead(
        broker_mode=mode,  # type: ignore[arg-type]
        external_broker_host=st.mqtt_ingest_external_broker_host,
        external_broker_port=st.mqtt_ingest_external_broker_port,
        subscribe_topic=st.mqtt_ingest_subscribe_topic,
        qos=qos,
    )


def _mqtt_deployment_read() -> MqttIngestDeploymentRead:
    return MqttIngestDeploymentRead(
        platform_broker_enabled=app_settings.platform_mqtt_broker_enabled,
        mqtt_bridge_deployed=app_settings.mqtt_bridge_deployed,
        listen_port=int(app_settings.mqtt_broker_probe_port),
        probe_host=app_settings.mqtt_broker_probe_host,
        sensor_connect_host_hint=app_settings.platform_mqtt_external_hostname_hint,
    )


def get_ports_config_read(db: Session, customer_id: uuid.UUID) -> PlatformPortsConfigRead:
    _ensure_default_ports(db, customer_id)
    st = _ensure_settings(db, customer_id)
    ports = db.scalars(
        select(PlatformPort)
        .where(PlatformPort.customer_id == customer_id)
        .order_by(PlatformPort.service_name)
    ).all()
    return PlatformPortsConfigRead(
        ports=[port_read_from_model(p) for p in ports],
        default_rest_publish_host=st.default_rest_publish_host,
        default_rest_publish_port=st.default_rest_publish_port,
        default_mqtt_publish_host=st.default_mqtt_publish_host,
        default_mqtt_publish_port=st.default_mqtt_publish_port,
        mqtt_ingest=_mqtt_tenant_read(st),
        mqtt_ingest_deployment=_mqtt_deployment_read(),
        allow_external_access=st.allow_external_access,
        restrict_to_localhost=st.restrict_to_localhost,
        enable_tls=st.enable_tls,
    )


def upsert_ports_config(db: Session, customer_id: uuid.UUID, body: PlatformPortsConfigUpdate) -> PlatformPortsConfigRead:
    _ensure_default_ports(db, customer_id)
    st = _ensure_settings(db, customer_id)
    by_name = {
        p.service_name: p
        for p in db.scalars(select(PlatformPort).where(PlatformPort.customer_id == customer_id)).all()
    }
    for item in body.ports:
        row = by_name.get(item.service_name)
        host = item.host.strip()
        if body.restrict_to_localhost and host not in ("127.0.0.1", "localhost", "::1"):
            host = "127.0.0.1"
        if row:
            row.protocol = item.protocol.strip().lower()
            row.host = host
            row.port = item.port
            row.enabled = item.enabled
        else:
            db.add(
                PlatformPort(
                    id=uuid.uuid4(),
                    customer_id=customer_id,
                    service_name=item.service_name.strip(),
                    protocol=item.protocol.strip().lower(),
                    host=host,
                    port=item.port,
                    enabled=item.enabled,
                )
            )
    st.default_rest_publish_host = body.default_rest_publish_host
    st.default_rest_publish_port = body.default_rest_publish_port
    st.default_mqtt_publish_host = body.default_mqtt_publish_host
    st.default_mqtt_publish_port = body.default_mqtt_publish_port
    st.mqtt_ingest_broker_mode = body.mqtt_ingest.broker_mode
    st.mqtt_ingest_external_broker_host = body.mqtt_ingest.external_broker_host
    st.mqtt_ingest_external_broker_port = body.mqtt_ingest.external_broker_port
    st.mqtt_ingest_subscribe_topic = body.mqtt_ingest.subscribe_topic
    st.mqtt_ingest_qos = body.mqtt_ingest.qos
    st.allow_external_access = body.allow_external_access
    st.restrict_to_localhost = body.restrict_to_localhost
    st.enable_tls = body.enable_tls
    db.commit()
    return get_ports_config_read(db, customer_id)


def test_ports_config(db: Session, customer_id: uuid.UUID) -> PlatformPortsTestResponse:
    data = get_ports_config_read(db, customer_id)
    results: list[PortProbeResult] = []
    conflicts: list[str] = []
    by_ep: dict[tuple[str, int], list[str]] = {}
    for p in data.ports:
        if not p.enabled:
            continue
        key = (p.host.lower(), p.port)
        by_ep.setdefault(key, []).append(p.service_name)
    for (h, port), names in by_ep.items():
        if len(names) > 1:
            conflicts.append(f"Enabled duplicate {h}:{port} ({', '.join(names)})")

    for p in data.ports:
        reachable = False
        detail = None
        if p.enabled:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(1.5)
                # 0.0.0.0 is bind-all; probe localhost for reachability check
                probe_host = "127.0.0.1" if p.host in ("0.0.0.0", "::") else p.host
                try:
                    sock.connect((probe_host, p.port))
                    reachable = True
                except OSError as e:
                    detail = str(e)
                finally:
                    sock.close()
            except Exception as e:
                detail = str(e)
        else:
            detail = "disabled"
        results.append(
            PortProbeResult(
                service_name=p.service_name,
                host=p.host,
                port=p.port,
                reachable=reachable,
                detail=detail,
            )
        )
    success = len(conflicts) == 0
    msg = "Probe complete."
    if conflicts:
        msg = "Configuration conflicts detected."
    elif not any(r.reachable for r in results):
        msg = "No enabled ports responded on TCP connect (may be normal if services run elsewhere)."
    return PlatformPortsTestResponse(success=success, results=results, conflicts=conflicts, message=msg)
