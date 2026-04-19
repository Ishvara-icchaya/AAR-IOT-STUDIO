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
    latest_detail_id: uuid.UUID | None = None
    latest_seen_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class DataObjectListResponse(BaseModel):
    items: list[DataObjectRead]


class DataObjectDetailRead(BaseModel):
    """One observed row from ``data_object_details`` (history / drill-down)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    data_object_id: uuid.UUID
    raw_data_object_id: uuid.UUID | None
    customer_id: uuid.UUID
    site_id: uuid.UUID
    device_id: uuid.UUID
    observed_at: datetime
    payload_json: dict[str, Any]
    kpi_json: dict[str, Any]
    health_status: str | None
    health_code: str | None
    health_message: str | None
    grouping_json: dict[str, Any]
    trace_id: str | None
    created_at: datetime


class DataObjectDetailListResponse(BaseModel):
    items: list[DataObjectDetailRead]
    total: int
    page: int
    page_size: int
