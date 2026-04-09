from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class LlmConfigRead(BaseModel):
    customer_id: str
    provider: str
    base_url: str
    model_name: str
    timeout_seconds: int
    max_rows: int
    max_prompt_chars: int
    query_timeout_seconds: int
    rate_limit_per_min: int
    enable_llm: bool
    enable_suggestions: bool
    enable_raw_debug: bool
    llm_failure_threshold: int
    llm_cooldown_seconds: int
    pipeline_failure_threshold: int
    pipeline_cooldown_seconds: int
    summary_prompt: str | None
    incident_prompt: str | None
    trend_prompt: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class LlmConfigUpdate(BaseModel):
    provider: str = Field(..., min_length=1, max_length=32)
    base_url: str = Field(..., min_length=1, max_length=2048)
    model_name: str = Field(..., min_length=1, max_length=128)
    timeout_seconds: int = Field(..., gt=0, le=3600)
    max_rows: int = Field(..., gt=0, le=5000)
    max_prompt_chars: int = Field(..., gt=0, le=100_000)
    query_timeout_seconds: int = Field(..., gt=0, le=3600)
    rate_limit_per_min: int = Field(..., gt=0, le=10_000)
    enable_llm: bool
    enable_suggestions: bool
    enable_raw_debug: bool
    llm_failure_threshold: int = Field(..., gt=0, le=1000)
    llm_cooldown_seconds: int = Field(..., gt=0, le=86400)
    pipeline_failure_threshold: int = Field(..., gt=0, le=1000)
    pipeline_cooldown_seconds: int = Field(..., gt=0, le=86400)
    summary_prompt: str | None = None
    incident_prompt: str | None = None
    trend_prompt: str | None = None


class LlmConfigTestResponse(BaseModel):
    success: bool
    provider: str
    base_url: str
    model_name: str
    message: str
    available_models: list[str] | None = None


class LlmConfigResetResponse(BaseModel):
    success: bool
    config: LlmConfigRead
