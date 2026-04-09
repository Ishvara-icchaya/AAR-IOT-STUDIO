"""Request/response models for Enterprise AI API."""

from __future__ import annotations

import uuid
from typing import Any

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AIChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=16_000)
    site_ids: list[uuid.UUID] | None = None
    time_range: str | None = Field(default="last_24_hours", max_length=64)
    use_llm: bool = True
    debug_raw: bool = False


class AIChatResponse(BaseModel):
    answer: str
    llm_used: bool
    degraded: bool
    mode: str
    evidence: dict[str, Any]
    plan: dict[str, Any]
    results: dict[str, Any]
    warnings: list[str] | None = None


class AISavedQueryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    question: str = Field(..., min_length=1, max_length=8000)
    default_site_scope_json: list[str] = Field(default_factory=list)
    default_time_range: str = Field(default="last_24_hours", max_length=64)


class AISavedQueryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    question: str
    default_site_scope_json: list[str]
    default_time_range: str
    created_at: datetime | None = None


class AIRecentQueryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question: str
    intent: str
    llm_used: bool
    degraded: bool
    response_mode: str | None = None
    created_at: datetime | None = None
