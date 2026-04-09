"""Ollama + AI worker status for monitoring (read-only)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ai_query import AiQuery
from app.services import monitoring_probes

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def build_ai_payload(
    *,
    r: Any | None,
    ollama_ok: bool,
    ollama_json: dict | None,
    ollama_err: str | None,
    db: Session | None = None,
    customer_id: uuid.UUID | None = None,
) -> dict:
    """Shape matches plan §8.6 (Phase 1: sparse metrics)."""
    model = None
    if ollama_ok and ollama_json and isinstance(ollama_json.get("models"), list):
        models = ollama_json["models"]
        if models and isinstance(models[0], dict):
            model = models[0].get("name") or models[0].get("model")

    ollama_status = "healthy" if ollama_ok else "critical"
    ai_worker_status = "unknown"
    if r is not None:
        try:
            ai_worker_status = (
                "healthy"
                if r.exists(monitoring_probes.WORKER_HEARTBEAT_KEY_PREFIX + "worker-ai")
                else "warning"
            )
        except Exception:
            ai_worker_status = "unknown"

    services = [
        {
            "service": "ollama",
            "status": ollama_status,
            "model": model,
            "requests_per_minute": None,
            "avg_latency_sec": None,
            "compute_mode": None,
            "last_error": None if ollama_ok else (ollama_err or "unreachable"),
        },
        {
            "service": "worker-ai",
            "status": ai_worker_status,
            "model": None,
            "requests_per_minute": None,
            "avg_latency_sec": None,
            "compute_mode": "cpu",
            "last_error": None,
        },
    ]

    recent: list[dict[str, Any]] = []
    if not ollama_ok and ollama_err:
        recent.append(
            {
                "time": _now_iso(),
                "severity": "warning",
                "message": f"Ollama probe failed: {ollama_err}"[:500],
            }
        )

    ops: dict[str, Any] = {}
    if r:
        try:
            v = r.get("ai:health:llm_failures_1h")
            ops["llm_failures_last_hour"] = int(v) if v is not None and str(v).isdigit() else 0
        except Exception:
            ops["llm_failures_last_hour"] = None
    if r and customer_id:
        try:
            v = r.get(f"ai:planner_fail_15m:{customer_id}")
            ops["planner_failures_last_15m"] = int(v) if v is not None and str(v).isdigit() else 0
        except Exception:
            ops["planner_failures_last_15m"] = None
        try:
            v = r.get(f"ai:execution_fail_15m:{customer_id}")
            ops["execution_failures_last_15m"] = int(v) if v is not None and str(v).isdigit() else 0
        except Exception:
            ops["execution_failures_last_15m"] = None
        try:
            sw = r.get(f"ai:suggestions:last_write:{customer_id}")
            if sw is not None:
                ops["suggestions_last_refresh_utc"] = sw.decode() if isinstance(sw, bytes) else str(sw)
        except Exception:
            pass
    last_q_at: str | None = None
    if db is not None and customer_id is not None:
        try:
            last = db.scalar(select(func.max(AiQuery.created_at)).where(AiQuery.customer_id == customer_id))
            if last is not None:
                last_q_at = last.isoformat().replace("+00:00", "Z")
        except Exception:
            log.debug("monitoring ai last query lookup failed", exc_info=True)
    ops["last_successful_ai_query_at"] = last_q_at

    return {"services": services, "recent_ai_issues": recent, "ops": ops}
