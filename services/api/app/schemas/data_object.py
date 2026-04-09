from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class DataObjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    device_id: uuid.UUID
    raw_data_object_id: uuid.UUID | None
    name: str
    payload: dict[str, Any]
    kpi_json: dict[str, Any]
    health_status: str | None
    health_code: str | None
    health_message: str | None
    scrubber_version: str | None
    has_gps: bool = False
    has_kpi: bool = False
    has_health: bool = False
    has_timeseries: bool = False
    lifecycle_status: str
    error_message: str | None
    trace_id: str | None
    created_at: datetime
    updated_at: datetime


class DataObjectListResponse(BaseModel):
    items: list[DataObjectRead]
