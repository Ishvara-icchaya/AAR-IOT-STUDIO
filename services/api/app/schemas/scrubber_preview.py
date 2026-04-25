from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field


class ScrubberPreviewRequest(BaseModel):
    raw_object_id: uuid.UUID
    mapping: dict[str, Any] | None = Field(
        default=None,
        description="Full or partial device_objects.mapping; merged with stored mapping when use_stored_mapping is true",
    )
    use_stored_mapping: bool = Field(
        default=True,
        description="Load device_object.mapping from DB and deep-merge scrubberStudio with mapping from this request",
    )


class ScrubberPreviewResult(BaseModel):
    object_name: str
    output_payload: dict[str, Any]
    kpi: dict[str, Any]
    health_status: str
    health_code: str
    health_message: str
    scrubber_version: str | None = None
    health_details: dict[str, Any] | None = None
    ai_projection: dict[str, Any] | None = Field(
        default=None,
        description="Role-bucket projection from device_objects.mapping.fieldCatalog (if defined).",
    )


class ScrubberPreviewResponse(BaseModel):
    raw_object_id: uuid.UUID
    device_id: uuid.UUID
    preview: ScrubberPreviewResult
    error: str | None = Field(default=None, description="Set when scrubberStudio missing or transform error")
