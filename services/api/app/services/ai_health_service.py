"""AI stack health for GET /ai/health and monitoring integration."""

from __future__ import annotations

import threading
from typing import Any

import httpx

from app.core.config import settings
from app.core.redis_sync import get_redis
from app.services.monitoring_collectors import probe_ollama


def _public_ollama_error(err: str | None) -> str | None:
    """Stable, operator-facing text — avoid raw httpx / errno dumps in the UI."""
    if not err:
        return None
    low = err.lower()
    if "connection refused" in low or "[errno 111]" in low or "errno 111" in low:
        return "Cannot reach Ollama at the configured URL (connection refused)."
    if "timed out" in low or "timeout" in low:
        return "Ollama did not respond in time (timeout)."
    if "name or service not known" in low or "nodename nor servname" in low or "temporary failure in name resolution" in low:
        return "Ollama host name could not be resolved (check OLLAMA_BASE_URL)."
    if "certificate" in low or "ssl" in low:
        return "TLS error talking to Ollama (check URL and certificates)."
    if "401" in err or "403" in err:
        return "Ollama rejected the request (auth / permission)."
    line = err.strip().split("\n", 1)[0].strip()
    return line[:240] + ("…" if len(line) > 240 else "")


def ai_health_payload() -> dict[str, Any]:
    ok, err, _tags = probe_ollama()
    err_pub = _public_ollama_error(err) if not ok else None
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
        "ollama_error": err_pub if not ok else None,
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
    model_name = (model or settings.ollama_model or "").strip()
    if not model_name:
        raise RuntimeError("OLLAMA model not set")
    payload: dict[str, Any] = {
        "model": model_name,
        "messages": messages,
        "stream": False,
    }
    ka = _parse_keep_alive(settings.ollama_request_keep_alive)
    if ka is not None:
        payload["keep_alive"] = ka
    opts: dict[str, Any] = {}
    np = int(settings.ollama_num_predict)
    if np > 0:
        opts["num_predict"] = np
    opts["temperature"] = float(settings.ollama_temperature)
    if opts:
        payload["options"] = opts

    client = _ollama_http_client(base)
    resp = client.post("/api/chat", json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    msg = (data.get("message") or {}) if isinstance(data, dict) else {}
    content = msg.get("content") if isinstance(msg, dict) else None
    if isinstance(content, str) and content.strip():
        return content.strip()[:8000]
    raise RuntimeError("empty_llm_response")
