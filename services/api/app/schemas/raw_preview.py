from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class RawPreviewResponse(BaseModel):
    raw_object_id: uuid.UUID
    offset: int
    requested_max_bytes: int
    total_size: int | None = None
    returned_bytes: int
    truncated: bool
    content_type: str | None
    encoding: Literal["utf8", "base64"]
    text: str | None = Field(default=None, description="Only when encoding=utf8")
    base64: str | None = Field(default=None, description="Only when encoding=base64")
