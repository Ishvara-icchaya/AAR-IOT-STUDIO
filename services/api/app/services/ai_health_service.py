"""AI stack health for GET /ai/health and monitoring integration."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import settings
from app.core.redis_sync import get_redis
from app.services.monitoring_collectors import probe_ollama


def ai_health_payload() -> dict[str, Any]:
    ok, err, _tags = probe_ollama()
    r = get_redis()
    recent_failures = 0
    if r:
        try:
            v = r.get("ai:health:llm_failures_1h")
            if v and str(v).isdigit():
                recent_failures = int(v)
        except Exception:
            pass
    return {
        "ollama_reachable": ok,
        "ollama_error": err,
        "model_configured": bool(settings.ollama_model),
        "ollama_model": settings.ollama_model,
        "recent_llm_failures_estimate": recent_failures,
        "suggestion_job_status": "inline",
    }


def bump_llm_failure_counter(db=None, customer_id=None) -> None:
    """Increment LLM failure counter; optionally emit alert when threshold reached."""
    from app.services.ai_failure_alerts import bump_llm_failure_and_maybe_alert

    bump_llm_failure_and_maybe_alert(db, customer_id)


def call_ollama_chat(
    messages: list[dict[str, str]],
    *,
    timeout: float,
    base_url: str | None = None,
    model: str | None = None,
) -> str:
    base = (base_url or settings.ollama_base_url or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("OLLAMA_BASE_URL not set")
    url = f"{base}/api/chat"
    model_name = (model or settings.ollama_model or "").strip()
    if not model_name:
        raise RuntimeError("OLLAMA model not set")
    payload = {
        "model": model_name,
        "messages": messages,
        "stream": False,
    }
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
    msg = (data.get("message") or {}) if isinstance(data, dict) else {}
    content = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(content, str) and content.strip():
        return content.strip()[:8000]
    raise RuntimeError("empty_llm_response")
