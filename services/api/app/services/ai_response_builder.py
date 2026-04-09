"""Assemble API response dict (single shape for /ai/chat)."""

from __future__ import annotations

from typing import Any


def chat_response(
    *,
    answer: str,
    llm_used: bool,
    degraded: bool,
    mode: str,
    evidence: dict[str, Any],
    plan: dict[str, Any],
    results: dict[str, Any],
    warnings: list[str],
) -> dict[str, Any]:
    safe_plan = {
        "dataset": plan.get("dataset"),
        "aggregation": plan.get("aggregation"),
        "limit": plan.get("limit"),
        "filters": plan.get("filters"),
        "intent": plan.get("intent"),
        "include_payload": plan.get("include_payload"),
        "time_range": plan.get("time_range"),
    }
    out: dict[str, Any] = {
        "answer": answer,
        "llm_used": llm_used,
        "degraded": degraded,
        "mode": mode,
        "evidence": evidence,
        "plan": safe_plan,
        "results": results,
    }
    if warnings:
        out["warnings"] = warnings
    return out
