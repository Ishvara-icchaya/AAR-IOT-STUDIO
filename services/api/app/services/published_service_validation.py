from __future__ import annotations

from typing import Any


def validate_target_config(*, publish_protocol: str, target_config_json: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    cfg = target_config_json or {}
    if publish_protocol == "rest":
        url = str(cfg.get("url") or "").strip()
        if not url:
            errs.append("REST publish requires target_config_json.url")
        method = str(cfg.get("method") or "POST").upper()
        if method not in ("GET", "POST", "PUT", "PATCH"):
            errs.append("REST method must be GET, POST, PUT, or PATCH")
        timeout = cfg.get("timeout_seconds", 30)
        try:
            if int(timeout) < 1 or int(timeout) > 300:
                errs.append("timeout_seconds must be between 1 and 300")
        except (TypeError, ValueError):
            errs.append("timeout_seconds must be an integer")
    elif publish_protocol == "mqtt":
        if not str(cfg.get("host") or "").strip():
            errs.append("MQTT publish requires target_config_json.host")
        if not str(cfg.get("topic") or "").strip():
            errs.append("MQTT publish requires target_config_json.topic")
        try:
            port = int(cfg.get("port", 1883))
            if port < 1 or port > 65535:
                errs.append("MQTT port must be 1–65535")
        except (TypeError, ValueError):
            errs.append("MQTT port must be an integer")
        try:
            qos = int(cfg.get("qos", 1))
            if qos not in (0, 1, 2):
                errs.append("MQTT qos must be 0, 1, or 2")
        except (TypeError, ValueError):
            errs.append("MQTT qos must be an integer")
    else:
        errs.append("Unknown publish_protocol")
    return errs
