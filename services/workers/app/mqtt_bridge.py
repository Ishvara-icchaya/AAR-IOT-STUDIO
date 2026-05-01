"""MQTT ingest: platform is a **subscriber client** to one or more brokers (per saved device endpoints).

Uses **one MQTT connection per distinct broker profile** (host, port, TLS, auth, optional client_id).
Subscriptions are merged by topic (max QoS) with provenance from Manage Devices rows.

**Not** the same as published-services MQTT (`publish_dispatch` / workflow outbound) — see
``docs/ARCHITECTURE_MQTT_INGEST.md``.

Reloads plans from Postgres on ``MQTT_TOPIC_RESYNC_SECONDS`` so UI changes apply without restart.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import ssl
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.client import CallbackAPIVersion, ConnectFlags, topic_matches_sub
from paho.mqtt.properties import Properties
from paho.mqtt.reasoncodes import ReasonCode

from app.ingest_archive import (
    ingest_json_payload,
    ingest_json_payload_for_endpoint,
    ingest_json_payload_for_mqtt_endpoint,
)
from app.logging_setup import configure_logging
from app.mqtt_bridge_subscriptions import (
    BrokerIngestGroup,
    IngestPlan,
    build_ingest_plan,
)
from app.worker_heartbeat import start_daemon as start_worker_heartbeat

configure_logging()
log = logging.getLogger(__name__)

MQTT_BRIDGE_SNAPSHOT_KEY = "aar:ingress:mqtt_bridge:snapshot"


@dataclass
class _ClientUserdata:
    """Per-connection context for logs (subscriber / ingest only)."""

    broker_host: str
    broker_port: int
    use_tls: bool
    group: BrokerIngestGroup


def _resync_interval_seconds() -> float:
    try:
        interval = float(os.environ.get("MQTT_TOPIC_RESYNC_SECONDS", "90"))
    except ValueError:
        interval = 90.0
    return max(15.0, interval)


def _write_operational_snapshot(plan: IngestPlan) -> None:
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        return
    payload = plan.to_snapshot_dict(int(_resync_interval_seconds()))
    try:
        import redis

        r = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        try:
            r.set(MQTT_BRIDGE_SNAPSHOT_KEY, json.dumps(payload, separators=(",", ":")))
        finally:
            try:
                r.close()
            except Exception:
                pass
    except Exception:
        log.debug("mqtt_bridge operational snapshot write failed", exc_info=True)


def _tls_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if os.environ.get("MQTT_INGEST_TLS_INSECURE", "").lower() in ("1", "true", "yes"):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        log.warning(
            "mqtt_bridge MQTT_INGEST_TLS_INSECURE enabled — TLS verification disabled (dev only)",
        )
    return ctx


def _mqtt_ingest_routes(group: BrokerIngestGroup, mqtt_topic: str) -> list[tuple[uuid.UUID, str]]:
    """Map message topic to (id, kind) with kind ``v2`` or ``device_endpoint`` (skip env-only hooks)."""
    seen: set[tuple[str, str]] = set()
    out: list[tuple[uuid.UUID, str]] = []
    for mt in group.merged_topics:
        try:
            matched = topic_matches_sub(mt.topic, mqtt_topic)
        except Exception:
            matched = False
        if not matched:
            continue
        for s in mt.sources:
            try:
                eid = uuid.UUID(s.endpoint_id)
            except ValueError:
                continue
            kind = getattr(s, "source_kind", None) or "v2"
            key = (str(eid), kind)
            if key in seen:
                continue
            seen.add(key)
            out.append((eid, kind))
    return out


def _on_message(_client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
    topic = msg.topic
    ud = userdata if isinstance(userdata, _ClientUserdata) else None
    broker_tag = (
        f"{ud.broker_host}:{ud.broker_port}" if ud else "?"
    )
    try:
        raw = msg.payload
        if not raw:
            log.info("mqtt_bridge empty payload ignored topic=%s broker=%s", topic, broker_tag)
            return
        log.info(
            "mqtt_bridge received topic=%s payload_bytes=%s broker=%s",
            topic,
            len(raw),
            broker_tag,
        )
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            log.warning("mqtt_bridge non-object json topic=%s broker=%s", topic, broker_tag)
            return
        body = raw
        group = ud.group if ud else None
        routes = _mqtt_ingest_routes(group, topic) if group else []
        if routes:
            for bind_id, kind in routes:
                if kind == "device_endpoint":
                    ok = ingest_json_payload_for_endpoint(
                        data,
                        body,
                        device_endpoint_id=bind_id,
                        protocol_source="mqtt",
                    )
                    log_id = f"device_endpoint_id={bind_id}"
                else:
                    ok = ingest_json_payload_for_mqtt_endpoint(
                        data,
                        body,
                        endpoint_id=bind_id,
                        protocol_source="mqtt",
                    )
                    log_id = f"endpoint_id={bind_id}"
                if ok:
                    log.info(
                        "mqtt_bridge archived raw ingest topic=%s broker=%s %s bytes=%s",
                        topic,
                        broker_tag,
                        log_id,
                        len(body),
                    )
                else:
                    log.error(
                        "mqtt_bridge ingest failed topic=%s broker=%s %s (see ingest_archive logs above)",
                        topic,
                        broker_tag,
                        log_id,
                    )
            return
        log.info(
            "mqtt_bridge no uuid-backed endpoint for topic=%s broker=%s; using payload device resolution (unbound)",
            topic,
            broker_tag,
        )
        ok = ingest_json_payload(data, body, protocol_source="mqtt")
        if ok:
            log.info(
                "mqtt_bridge archived raw ingest topic=%s broker=%s (payload identity) bytes=%s",
                topic,
                broker_tag,
                len(body),
            )
        else:
            log.error(
                "mqtt_bridge ingest failed topic=%s broker=%s (unbound): payload device could not be resolved "
                "to a registered device — see ingest_archive errors above, or add a MQTT device endpoint "
                "for this broker/topic so the saved endpoint selects the device",
                topic,
                broker_tag,
            )
    except json.JSONDecodeError:
        log.warning("mqtt_bridge invalid json topic=%s broker=%s", topic, broker_tag)
    except UnicodeDecodeError:
        log.warning("mqtt_bridge invalid utf-8 topic=%s broker=%s", topic, broker_tag)
    except Exception:
        log.exception("mqtt_bridge handler error topic=%s broker=%s", topic, broker_tag)


def _make_on_connect(group: BrokerIngestGroup):
    k = group.key
    auth_label = "user" if k.username else "none"
    broker_tag = f"{k.host}:{k.port}"

    def on_connect(
        client: mqtt.Client,
        _userdata: object,
        _connect_flags: ConnectFlags,
        reason_code: ReasonCode,
        _properties: Properties | None,
    ) -> None:
        if reason_code.is_failure:
            log.error(
                "mqtt_bridge ingest connect failed broker=%s tls=%s auth=%s client_id=%s reason=%s",
                broker_tag,
                k.use_tls,
                auth_label,
                group.mqtt_client_id,
                reason_code,
            )
            return
        log.info(
            "mqtt_bridge ingest connected broker_host=%s broker_port=%s tls=%s auth=%s "
            "mqtt_client_id=%s reason=%s",
            k.host,
            k.port,
            k.use_tls,
            auth_label,
            group.mqtt_client_id,
            reason_code,
        )
        for mt in group.sorted_topics():
            src_payload = [
                {
                    "endpoint_id": s.endpoint_id,
                    "endpoint_name": s.endpoint_name,
                }
                for s in mt.sources
            ]
            try:
                client.subscribe(mt.topic, qos=mt.qos)
                log.info(
                    "mqtt_bridge subscribed topic=%s qos=%s broker=%s sources=%s",
                    mt.topic,
                    mt.qos,
                    broker_tag,
                    src_payload,
                )
            except Exception:
                log.exception(
                    "mqtt_bridge subscribe failed topic=%s broker=%s",
                    mt.topic,
                    broker_tag,
                )

    return on_connect


class _ManagedClient:
    __slots__ = ("client", "group")

    def __init__(self, client: mqtt.Client, group: BrokerIngestGroup) -> None:
        self.client = client
        self.group = group


class MultiBrokerIngestRunner:
    """Starts one paho client per BrokerIngestGroup; full rebuild on plan change."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._managed: list[_ManagedClient] = []
        self._fingerprint: str | None = None

    @property
    def fingerprint(self) -> str | None:
        return self._fingerprint

    def shutdown(self) -> None:
        with self._lock:
            for m in self._managed:
                try:
                    m.client.loop_stop()
                except Exception:
                    log.debug("mqtt_bridge loop_stop", exc_info=True)
                try:
                    m.client.disconnect()
                except Exception:
                    log.debug("mqtt_bridge disconnect", exc_info=True)
            self._managed.clear()
            self._fingerprint = None

    def apply_plan(self, plan: IngestPlan) -> None:
        fp = plan.fingerprint()
        with self._lock:
            if fp == self._fingerprint:
                _write_operational_snapshot(plan)
                return
            for m in self._managed:
                try:
                    m.client.loop_stop()
                except Exception:
                    log.debug("mqtt_bridge loop_stop", exc_info=True)
                try:
                    m.client.disconnect()
                except Exception:
                    log.debug("mqtt_bridge disconnect", exc_info=True)
            self._managed.clear()
            self._fingerprint = fp

            if not plan.groups:
                log.warning(
                    "mqtt_bridge no ingest broker connections (no active mqtt device endpoints with "
                    "broker_host + topic, and no usable MQTT_TOPICS + MQTT_BROKER_HOST). Waiting for resync.",
                )
                _write_operational_snapshot(plan)
                return

            log.info(
                "mqtt_bridge ingest opening %s broker connection(s) (subscriber clients)",
                len(plan.groups),
            )
            for group in plan.groups:
                k = group.key
                userdata = _ClientUserdata(
                    broker_host=k.host,
                    broker_port=k.port,
                    use_tls=k.use_tls,
                    group=group,
                )
                client = mqtt.Client(
                    callback_api_version=CallbackAPIVersion.VERSION2,
                    client_id=group.mqtt_client_id,
                    protocol=mqtt.MQTTv311,
                    userdata=userdata,
                )
                if k.use_tls:
                    try:
                        client.tls_set_context(_tls_context())
                    except Exception:
                        log.exception("mqtt_bridge tls_set_context failed broker=%s:%s", k.host, k.port)
                if k.username:
                    client.username_pw_set(k.username, k.password)
                client.on_connect = _make_on_connect(group)
                client.on_message = _on_message
                try:
                    log.info(
                        "mqtt_bridge ingest connecting broker_host=%s broker_port=%s tls=%s "
                        "auth=%s mqtt_client_id=%s topics=%s",
                        k.host,
                        k.port,
                        k.use_tls,
                        "user" if k.username else "none",
                        group.mqtt_client_id,
                        [m.topic for m in group.sorted_topics()],
                    )
                    client.connect(k.host, k.port, keepalive=60)
                    client.loop_start()
                    self._managed.append(_ManagedClient(client, group))
                except Exception:
                    log.exception(
                        "mqtt_bridge failed to start client broker=%s:%s",
                        k.host,
                        k.port,
                    )

            _write_operational_snapshot(plan)
            flat = plan.all_topics_flat()
            if flat:
                log.info(
                    "mqtt_bridge active subscription filters (only matching topics are ingested): %s",
                    sorted(flat.keys()),
                )


def main() -> None:
    runner = MultiBrokerIngestRunner()
    stop_resync = threading.Event()

    def stop(_signum: int, _frame: object | None) -> None:
        stop_resync.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    start_worker_heartbeat("worker-mqtt-bridge")

    initial = build_ingest_plan()
    if initial.groups:
        log.info(
            "mqtt_bridge Phase 1 ingest model: %s subscriber connection(s) from device endpoints "
            "(grouped by broker host/port/TLS/auth/client_id); published-services MQTT is separate.",
            len(initial.groups),
        )
    runner.apply_plan(initial)

    def resync_loop() -> None:
        interval = _resync_interval_seconds()
        while not stop_resync.wait(interval):
            try:
                plan = build_ingest_plan()
                runner.apply_plan(plan)
            except Exception:
                log.exception("mqtt_bridge periodic resync failed")

    threading.Thread(target=resync_loop, name="mqtt-bridge-resync", daemon=True).start()

    try:
        while not stop_resync.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt:
        stop_resync.set()
    finally:
        stop_resync.set()
        runner.shutdown()


if __name__ == "__main__":
    main()
