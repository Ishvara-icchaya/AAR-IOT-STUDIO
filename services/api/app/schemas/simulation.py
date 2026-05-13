"""Phase 10 replay simulation API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ReplaySimulationCreate(BaseModel):
    device_id: uuid.UUID
    candidate_device_version_id: uuid.UUID | None = None
    baseline_device_version_id: uuid.UUID | None = None
    scope_hours: int = Field(default=168, ge=1, le=24 * 90)
    sample_size: int = Field(default=200, ge=10, le=2000)


class SimulationJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    device_id: uuid.UUID
    created_by: uuid.UUID | None
    baseline_device_version_id: uuid.UUID | None
    candidate_device_version_id: uuid.UUID | None
    window_start: datetime
    window_end: datetime
    sample_size: int
    records_tested: int
    records_passed: int
    records_failed: int
    status: str
    error_message: str | None
    result_json: dict[str, Any] | None
    created_at: datetime
    completed_at: datetime | None
