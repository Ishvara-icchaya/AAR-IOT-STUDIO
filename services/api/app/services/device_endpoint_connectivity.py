"""Connectivity checks for Manage Devices "Run validation" (not raw preview)."""

from __future__ import annotations

import logging
import socket
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


def check_mqtt_connectivity(config: dict[str, Any]) -> tuple[bool, str]:
    h = config.get("broker_host") or config.get("host")
    p = config.get("broker_port", config.get("port", 1883))
    try:
        port = int(p)
    except (TypeError, ValueError):
        port = 1883
    if not h or not str(h).strip():
        return False, "MQTT broker host is missing in saved configuration."
    host = str(h).strip()
    ok, msg = _tcp_check(host, port)
    return ok, msg


def check_http_connectivity(config: dict[str, Any]) -> tuple[bool, str]:
    rm = config.get("rest_mode")
    if rm == "polling":
        url = (config.get("polling_url") or "").strip()
        if not url:
            return False, "REST polling URL is empty."
        try:
            headers: dict[str, str] = {}
            hj = config.get("headers_json")
            if isinstance(hj, str) and hj.strip():
                import json

                parsed = json.loads(hj)
                if isinstance(parsed, dict):
                    headers = {str(k): str(v) for k, v in parsed.items()}
            auth_type = config.get("auth_type")
            if auth_type == "bearer":
                tok = config.get("auth_header_value") or ""
                headers["Authorization"] = f"Bearer {tok}"
            elif auth_type == "header":
                name = (config.get("auth_header_name") or "Authorization").strip()
                headers[name] = str(config.get("auth_header_value") or "")
            method = (config.get("method") or "GET").upper()
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

    url = (config.get("url") or "").strip()
    if not url:
        return False, "REST inbound URL is empty."
    parsed = _parse_url_host_port(url, bool(config.get("use_tls")))
    if not parsed:
        return False, "Could not parse REST URL."
    host, port, _tls = parsed
    return _tcp_check(host, port)


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
    if p in ("http", "https"):
        return check_http_connectivity(config)
    if p == "websocket":
        return check_websocket_connectivity(config)
    if p == "coap":
        return check_coap_connectivity(config)
    return False, f"Unknown protocol {protocol!r} for connectivity check."
