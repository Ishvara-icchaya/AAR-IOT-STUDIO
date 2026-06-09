"""Pydantic models for GET /trends/window (contract v1.1)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TrendBucketPoint(BaseModel):
    """One bucket in a window series (full stats by default)."""

    ts: str = Field(..., description="Bucket start (ISO-8601 UTC)")
    avg: float | None = None
    min: float | None = None
    max: float | None = None
    stddev: float | None = None
    n: int | None = None
    is_partial: bool = False


class TrendsWindowResponse(BaseModel):
    scope: Literal["resolved_device", "endpoint", "site"]
    entity_id: str = Field(..., serialization_alias="entityId")
    window: Literal["1h", "24h"]
    bucket: Literal["5m"] = "5m"
    as_of: str
    series: dict[str, list[TrendBucketPoint]]
    governance: dict[str, str | None] | None = None

    model_config = {"populate_by_name": True}
