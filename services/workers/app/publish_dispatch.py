"""REST/MQTT dispatch (worker-publish)."""

from __future__ import annotations

import json
import logging
from typing import Any

log = logging.getLogger(__name__)


def dispatch_publish(
    *,
    publish_protocol: str,
    target_config_json: dict[str, Any],
    payload: dict[str, Any],
) -> tuple[bool, str | None, str | None]:
    if publish_protocol == "rest":
        return _dispatch_rest(target_config_json, payload)
    if publish_protocol == "mqtt":
        return _dispatch_mqtt(target_config_json, payload)
    return False, None, "Unknown protocol"


def _dispatch_rest(cfg: dict[str, Any], payload: dict[str, Any]) -> tuple[bool, str | None, str | None]:
    import httpx

    url = str(cfg.get("url") or "").strip()
    method = str(cfg.get("method") or "POST").upper()
    headers = cfg.get("headers") if isinstance(cfg.get("headers"), dict) else {}
    timeout = float(cfg.get("timeout_seconds", 30))
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.request(method, url, headers=headers, json=payload)
            ok = 200 <= r.status_code < 300
            msg = (r.text or "")[:4000]
            return ok, str(r.status_code), None if ok else msg
    except Exception as e:
        log.debug("rest publish failed", exc_info=True)
        return False, None, str(e)[:2000]


def _dispatch_mqtt(cfg: dict[str, Any], payload: dict[str, Any]) -> tuple[bool, str | None, str | None]:
    try:
        import paho.mqtt.publish as mqtt_publish
    except ImportError:
        return False, None, "paho-mqtt not installed"

    host = str(cfg.get("host") or "").strip()
    port = int(cfg.get("port", 1883))
    topic = str(cfg.get("topic") or "").strip()
    qos = int(cfg.get("qos", 1))
    body = json.dumps(payload, default=str)
    user = cfg.get("username")
    password = cfg.get("password")
    auth: dict[str, Any] | None = None
    if user is not None:
        auth = {"username": str(user), "password": str(password or "")}
    try:
        mqtt_publish.single(
            topic,
            payload=body,
            hostname=host,
            port=port,
            qos=qos,
            auth=auth,
        )
        return True, "mqtt", None
    except Exception as e:
        log.debug("mqtt publish failed", exc_info=True)
        return False, None, str(e)[:2000]
