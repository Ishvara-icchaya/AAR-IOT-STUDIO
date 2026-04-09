"""POST /scrubber/test-llm-overlay — run LLM KPI/health overlay on a snapshot."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TestLlmOverlayRequest(BaseModel):
    mapping_draft: dict[str, Any] = Field(default_factory=dict)
    output_payload: dict[str, Any] = Field(default_factory=dict)
    kpi: dict[str, Any] = Field(default_factory=dict)
    health_status: str = "green"
    health_code: str = "ok"
    health_message: str = ""


class TestLlmOverlayResponse(BaseModel):
    kpi: dict[str, Any] = Field(default_factory=dict)
    health_status: str = "green"
    health_code: str = "ok"
    health_message: str = ""
    error: str | None = None
