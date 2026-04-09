"""Test connectivity to Ollama (or compatible) HTTP API."""

from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)


def test_ollama_connection(*, base_url: str, model_name: str, timeout_sec: float = 8.0) -> dict[str, Any]:
    base = (base_url or "").rstrip("/")
    if not base:
        return {
            "success": False,
            "message": "base_url is empty",
            "available_models": None,
        }
    models: list[str] = []
    try:
        with httpx.Client(timeout=timeout_sec) as client:
            r = client.get(f"{base}/api/tags")
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and isinstance(data.get("models"), list):
                for m in data["models"]:
                    if isinstance(m, dict) and m.get("name"):
                        models.append(str(m["name"]))
    except Exception as e:
        log.info("ollama tags probe failed: %s", e)
        return {
            "success": False,
            "message": f"Could not reach Ollama at {base}: {e}",
            "available_models": None,
        }

    model_ok = not model_name or model_name in models or any(
        m == model_name or m.split(":")[0] == model_name.split(":")[0] for m in models
    )
    msg = "Connection OK."
    if models and not model_ok:
        msg = f"Connected but model {model_name!r} not listed in /api/tags."
    return {
        "success": True,
        "message": msg,
        "available_models": models or None,
    }
