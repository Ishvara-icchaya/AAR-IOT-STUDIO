"""Phase 13 control-plane audit API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ControlPlaneAuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID | None
    actor_user_id: uuid.UUID | None
    action_type: str
    resource_type: str
    resource_id: uuid.UUID | None
    correlation_id: str | None
    payload_json: dict[str, Any] | None
    created_at: datetime


class ControlPlaneAuditEventListResponse(BaseModel):
    items: list[ControlPlaneAuditEventRead]
