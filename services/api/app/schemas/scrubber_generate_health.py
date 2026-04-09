"""Request/response for POST /scrubber/generate-health-mapping."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class GenerateHealthMappingRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=16_000)
    mapping_draft: dict[str, Any] = Field(default_factory=dict)
    live_snapshot: dict[str, Any] | None = None
    compiled_snapshot: dict[str, Any] | None = None


class GenerateHealthMappingResponse(BaseModel):
    health_mode: str = "rules"
    health_rules: list[dict[str, Any]] = Field(default_factory=list)
    health_fixed: dict[str, Any] | None = None
    llm_health_kpi: dict[str, Any] | None = None
    rationale: str | None = None
    error: str | None = None
