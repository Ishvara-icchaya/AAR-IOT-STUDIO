"""Devices with scrubber mappings but no recent raw ingestion."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class StaleIngestionDeviceItem(BaseModel):
    device_id: uuid.UUID
    device_name: str
    site_id: uuid.UUID
    site_name: str
    scrubber_version: str | None = None
    latest_raw_id: uuid.UUID | None = None
    latest_raw_ingested_at: datetime | None = None
    raw_object_count: int = 0


class StaleIngestionDeviceListResponse(BaseModel):
    items: list[StaleIngestionDeviceItem] = Field(default_factory=list)
    stale_after_hours: float = Field(
        description="A device is listed if it has no raw, or its newest raw is older than this window (UTC)."
    )
