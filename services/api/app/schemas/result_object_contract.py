"""Frozen public API contract for workflow result_object (v1).

Dashboard and external clients MUST depend only on these fields.
Any additive change requires a documented version bump (e.g. v2 schema).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# Explicit field list for docs / codegen (order is canonical)
RESULT_OBJECT_V1_FIELD_NAMES: tuple[str, ...] = (
    "id",
    "workflow_id",
    "terminate_node_id",
    "result_object_name",
    "site_id",
    "customer_id",
    "payload_json",
    "health_status",
    "created_at",
)


class ResultObjectV1(BaseModel):
    """Canonical result_object row exposed over HTTP (v1)."""

    model_config = ConfigDict(
        from_attributes=True,
        frozen=True,
        str_strip_whitespace=True,
    )

    id: uuid.UUID
    workflow_id: uuid.UUID
    terminate_node_id: uuid.UUID | None = None
    result_object_name: str = Field(..., max_length=255)
    site_id: uuid.UUID
    customer_id: uuid.UUID
    payload_json: dict[str, Any] = Field(default_factory=dict)
    health_status: str | None = Field(None, max_length=16)
    created_at: datetime


class ResultObjectListV1Response(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[ResultObjectV1]
