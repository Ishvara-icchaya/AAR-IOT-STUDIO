"""Validate LLM admin config updates (Phase 1: Ollama only)."""

from __future__ import annotations

from fastapi import HTTPException, status

from app.schemas.llm_config import LlmConfigUpdate

_MAX_TEMPLATE = 50_000


def validate_llm_config_update(body: LlmConfigUpdate) -> LlmConfigUpdate:
    prov = (body.provider or "").strip().lower()
    if prov != "ollama":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Only provider 'ollama' is supported in Phase 1.",
        )
    for name, val in (
        ("summary_prompt", body.summary_prompt),
        ("incident_prompt", body.incident_prompt),
        ("trend_prompt", body.trend_prompt),
    ):
        if val is not None and len(val) > _MAX_TEMPLATE:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"{name} exceeds maximum length ({_MAX_TEMPLATE} characters).",
            )
    return body
