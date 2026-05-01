"""Connectivity checks for Manage Devices "Run validation" (not raw preview)."""

from __future__ import annotations

import logging
import os
import socket
import ssl
import threading
import time
import uuid
from typing import Any
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)


def _tcp_check(host: str, port: int, *, timeout: float = 2.5) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
        return True, f"TCP reachable {host}:{port}"
    except OSError as e:
        return False, f"TCP {host}:{port} unreachable: {e}"


def _parse_url_host_port(url: str, default_tls: bool) -> tuple[str, int, bool] | None:
    try:
        u = urlparse(url.strip())
    except Exception:
        return None
    if not u.hostname:
        return None
    scheme = (u.scheme or "http").lower()
    tls = scheme in ("https", "wss") or default_tls
    port = u.port
    if port is None:
        port = 443 if tls else 80
    return u.hostname, port, tls


def _mqtt_broker_host_port_tls(config: dict[str, Any]) -> tuple[str, int, bool] | None:
    mode = str(config.get("broker_mode") or "external").strip().lower()
    h = config.get("broker_host") or config.get("host")
    host = str(h).strip() if h else ""
    if mode == "internal" and not host:
        host = "mosquitto"
    if not host:
        return None
    raw_port = config.get("broker_port", config.get("port", 1883))
    try:
        port = int(raw_port)
    except (TypeError, ValueError):
        port = 1883
    use_tls = bool(config.get("use_tls")) or port == 8883
    return host, port, use_tls


def check_mqtt_connectivity(config: dict[str, Any]) -> tuple[bool, str]:
    parsed = _mqtt_broker_host_port_tls(config)
    if not parsed:
        return False, "MQTT broker host is missing in saved configuration."
    host, port, _tls = parsed
    ok, msg = _tcp_check(host, port)
    return ok, msg


MQTT_LIVE_OK = "ok"
MQTT_LIVE_NO_MESSAGE = "no_message"
MQTT_LIVE_ERROR = "error"


def mqtt_subscribe_wait_for_message(
    config: dict[str, Any],
    *,
    wait_seconds: float = 12.0,
) -> tuple[str, str]:
    """Connect as MQTT subscriber, subscribe to ``config.topic``, wait for the first message.

    Returns ``(kind, detail)`` where ``kind`` is ``MQTT_LIVE_OK``, ``MQTT_LIVE_NO_MESSAGE``, or ``MQTT_LIVE_ERROR``.
    """
    parsed = _mqtt_broker_host_port_tls(config)
    if not parsed:
        return MQTT_LIVE_ERROR, "MQTT broker host is missing."
    host, port, use_tls = parsed
    topic = str(config.get("topic") or "").strip()
    if not topic:
        return MQTT_LIVE_ERROR, "MQTT topic is empty."
    try:
        qos = int(config.get("qos", 0))
    except (TypeError, ValueError):
        qos = 0
    qos = max(0, min(2, qos))
    user = str(config.get("username") or "").strip()
    pw_raw = config.get("password")
    password = str(pw_raw) if pw_raw is not None else ""

    done = threading.Event()
    state: dict[str, Any] = {"err": None, "got": False, "bytes": 0, "msg_topic": "", "connected": False}

    try:
        import paho.mqtt.client as mqtt
        from paho.mqtt.client import CallbackAPIVersion
        from paho.mqtt.properties import Properties
        from paho.mqtt.reasoncodes import ReasonCode
    except Exception as e:  # pragma: no cover
        return MQTT_LIVE_ERROR, f"MQTT client library unavailable: {e!s}"

    def on_connect(
        client: mqtt.Client,
        _userdata: object,
        _flags: object,
        reason_code: ReasonCode,
        _properties: Properties | None,
    ) -> None:
        if reason_code.is_failure:
            state["err"] = f"MQTT connect failed: {reason_code}"
            done.set()
            return
        state["connected"] = True
        try:
            client.subscribe(topic, qos)
        except Exception as e:
            state["err"] = f"MQTT subscribe failed: {e!s}"[:500]
            done.set()

    def on_message(_client: mqtt.Client, _userdata: object, msg: mqtt.MQTTMessage) -> None:
        state["got"] = True
        state["bytes"] = len(msg.payload or b"")
        state["msg_topic"] = getattr(msg, "topic", "") or ""
        done.set()

    cid = f"aar-validate-{uuid.uuid4().hex[:16]}"
    client = mqtt.Client(
        callback_api_version=CallbackAPIVersion.VERSION2,
        client_id=cid,
        protocol=mqtt.MQTTv311,
    )
    if use_tls:
        try:
            ctx = ssl.create_default_context()
            if os.environ.get("MQTT_INGEST_TLS_INSECURE", "").lower() in ("1", "true", "yes"):
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            client.tls_set_context(ctx)
        except Exception as e:
            return MQTT_LIVE_ERROR, f"MQTT TLS setup failed: {e!s}"[:500]
    if user:
        client.username_pw_set(user, password)
    client.on_connect = on_connect
    client.on_message = on_message
    deadline = time.monotonic() + max(3.0, float(wait_seconds))
    try:
        client.connect(host, port, keepalive=min(30, int(wait_seconds) + 5))
    except Exception as e:
        return MQTT_LIVE_ERROR, f"MQTT connect error: {e!s}"[:500]
    client.loop_start()
    try:
        while time.monotonic() < deadline:
            if done.wait(0.2):
                break
        if state["err"]:
            return MQTT_LIVE_ERROR, str(state["err"])
        if state["got"]:
            mt = state["msg_topic"] or topic
            return MQTT_LIVE_OK, (
                f"Subscribed to {topic!r} and received a message on {mt!r} "
                f"({int(state['bytes'])} bytes within {wait_seconds:.0f}s)."
            )
        if not state["connected"]:
            return MQTT_LIVE_ERROR, f"MQTT connect to {host}:{port} did not complete within {wait_seconds:.0f}s."
        return MQTT_LIVE_NO_MESSAGE, (
            f"Subscribed to {topic!r} on {host}:{port}; no MQTT message arrived within {wait_seconds:.0f}s "
            "(broker is reachable — confirm a publisher is sending payloads matching this filter)."
        )
    finally:
        try:
            client.loop_stop()
        except Exception:
            pass
        try:
            client.disconnect()
        except Exception:
            pass


def _effective_polling_url(config: dict[str, Any]) -> str:
    """Match worker-rest-poller: explicit ``polling_url`` / ``pollingUrl`` or composite ``url``."""
    pu = str(config.get("polling_url") or config.get("pollingUrl") or "").strip()
    if pu:
        return pu
    return str(config.get("url") or "").strip()


def _rest_mode(config: dict[str, Any]) -> str:
    r = config.get("rest_mode") if config.get("rest_mode") is not None else config.get("restMode")
    return str(r or "").strip().lower()


def _rest_poll_http_method(config: dict[str, Any]) -> str:
    """HTTP verb for REST Pull polling. Defaults to GET; only GET/HEAD/POST are allowed (PUT etc. break typical metrics APIs)."""
    raw = config.get("method")
    if raw is None or (isinstance(raw, str) and not str(raw).strip()):
        raw = config.get("httpMethod") or config.get("http_method")
    m = str(raw or "GET").strip().upper() or "GET"
    allowed = frozenset({"GET", "HEAD", "POST"})
    if m not in allowed:
        log.info("rest_poll_http_method: unsupported %r in endpoint config, using GET", m)
        return "GET"
    return m


def check_http_connectivity(config: dict[str, Any]) -> tuple[bool, str]:
    rm = _rest_mode(config)
    if rm == "inbound_hook":
        return (
            True,
            "REST Push (Push to Platform): the platform does not call an upstream URL. "
            "Cadence is controlled by the upstream system when it POSTs to the ingest API.",
        )
    if rm == "polling":
        url = _effective_polling_url(config)
        if not url:
            return False, "REST Pull: upstream URL is empty (set upstream URL or Host + Port + Path)."
        try:
            headers: dict[str, str] = {}
            hj = config.get("headers_json") or config.get("headersJson")
            if isinstance(hj, str) and hj.strip():
                import json

                parsed = json.loads(hj)
                if isinstance(parsed, dict):
                    headers = {str(k): str(v) for k, v in parsed.items()}
            auth_type = str(config.get("auth_type") or config.get("authType") or "").lower()
            if auth_type == "bearer":
                tok = str(config.get("auth_header_value") or config.get("authHeaderValue") or "")
                headers["Authorization"] = f"Bearer {tok}"
            elif auth_type == "header":
                name = str(config.get("auth_header_name") or config.get("authHeaderName") or "Authorization").strip()
                headers[name] = str(config.get("auth_header_value") or config.get("authHeaderValue") or "")
            method = _rest_poll_http_method(config)
            timeout_s = config.get("timeout_seconds", 30)
            try:
                t = float(timeout_s)
            except (TypeError, ValueError):
                t = 15.0
            t = max(2.0, min(t, 30.0))
            with httpx.Client(timeout=t) as client:
                r = client.request(method, url, headers=headers)
            if r.is_success:
                return True, f"HTTP {method} {url[:120]} → {r.status_code}"
            return False, f"HTTP {method} returned {r.status_code} for polling URL."
        except httpx.HTTPError as e:
            return False, f"HTTP polling request failed: {e!s}"[:500]
        except Exception as e:
            return False, f"HTTP polling check error: {e!s}"[:500]

    # Legacy configs without rest_mode: best-effort TCP probe on stored url
    url = (config.get("url") or "").strip()
    if url:
        parsed = _parse_url_host_port(url, bool(config.get("use_tls")))
        if parsed:
            host, port, _tls = parsed
            return _tcp_check(host, port)
        return False, "Could not parse REST URL."
    return False, "REST: set Push to Platform or Pull from Upstream (rest_mode)."


def check_websocket_connectivity(config: dict[str, Any]) -> tuple[bool, str]:
    url = (config.get("url") or "").strip()
    if not url:
        return False, "WebSocket URL is empty."
    parsed = _parse_url_host_port(url, url.strip().lower().startswith("wss:"))
    if not parsed:
        return False, "Could not parse WebSocket URL."
    host, port, _tls = parsed
    return _tcp_check(host, port)


def check_coap_connectivity(config: dict[str, Any]) -> tuple[bool, str]:
    h = (config.get("host") or "").strip()
    p = config.get("port", 5683)
    try:
        port = int(p)
    except (TypeError, ValueError):
        port = 5683
    if not h:
        return False, "CoAP host is empty."
    try:
        socket.getaddrinfo(h, port, type=socket.SOCK_DGRAM)
    except OSError as e:
        return False, f"CoAP host DNS/lookup failed: {e!s}"[:300]
    return True, (
        f"Resolved {h}:{port} (UDP CoAP not executed from API; "
        "confirm listener/firewall separately.)"
    )


def run_connectivity_for_protocol(protocol: str, config: dict[str, Any]) -> tuple[bool, str]:
    p = (protocol or "").lower()
    if p == "mqtt":
        return check_mqtt_connectivity(config)
    if p in ("http", "https", "rest"):
        return check_http_connectivity(config)
    if p == "websocket":
        return check_websocket_connectivity(config)
    if p == "coap":
        return check_coap_connectivity(config)
    return False, f"Unknown protocol {protocol!r} for connectivity check."
