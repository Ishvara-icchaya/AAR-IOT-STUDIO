from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field


class HealthThresholdReferenceRead(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID | None = None
    device_id: uuid.UUID | None = None
    reference_name: str
    body_json: dict[str, Any] = Field(default_factory=dict)


class HealthThresholdReferenceListResponse(BaseModel):
    items: list[HealthThresholdReferenceRead]


class HealthThresholdReferenceCreate(BaseModel):
    reference_name: str = Field(..., min_length=1, max_length=255)
    body_json: dict[str, Any] = Field(default_factory=dict)
    site_id: uuid.UUID | None = None
    device_id: uuid.UUID | None = None


class HealthThresholdReferenceUpdate(BaseModel):
    reference_name: str | None = Field(default=None, min_length=1, max_length=255)
    body_json: dict[str, Any] | None = None
