"""Static ingestion API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StaticIngestionValidateRequest(BaseModel):
    site_id: uuid.UUID
    device_id: uuid.UUID | None = None
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    end_at: datetime | None = None
    schedule_json: dict[str, Any] = Field(default_factory=dict)
    payload_json: dict[str, Any] = Field(default_factory=dict)


class StaticIngestionValidateResponse(BaseModel):
    valid: bool
    errors: list[str]


class StaticIngestionCreate(StaticIngestionValidateRequest):
    """Same fields as validate; persisted when valid."""


class StaticIngestionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    end_at: datetime | None = None
    schedule_json: dict[str, Any] | None = None
    payload_json: dict[str, Any] | None = None


class StaticIngestionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    name: str
    description: str | None
    end_at: datetime | None
    schedule_json: dict[str, Any]
    payload_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class StaticIngestionListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    device_id: uuid.UUID | None
    name: str
    description: str | None
    end_at: datetime | None
    updated_at: datetime


class StaticIngestionListResponse(BaseModel):
    items: list[StaticIngestionListItem]
