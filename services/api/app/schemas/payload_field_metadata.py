"""API response for payload field catalog (Phase E)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PayloadFieldEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    path: str = Field(..., min_length=1)
    type: str = Field(..., min_length=1)
    sample: Any = None
    section: str | None = None
    source: str = Field(default="payload", min_length=1)


class PayloadFieldMetadataResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[PayloadFieldEntry]
