from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class RawObjectListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    device_name: str
    site_id: uuid.UUID
    site_name: str
    protocol_source: str | None
    captured_at: datetime | None
    ingested_at: datetime
    size_bytes: int | None
    ingest_status: str
    verify_status: str
    verified_at: datetime | None
    checksum_sha256: str | None
    ingest_metadata: dict[str, Any] | None = None


class RawObjectListResponse(BaseModel):
    items: list[RawObjectListItem]
    total: int
