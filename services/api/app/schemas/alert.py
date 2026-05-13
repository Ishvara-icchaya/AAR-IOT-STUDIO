from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.alert_severity import normalize_severity


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID | None
    device_id: uuid.UUID | None
    category: str
    severity: str

    @field_validator("severity", mode="before")
    @classmethod
    def _norm_sev(cls, v: object) -> str:
        return normalize_severity(str(v) if v is not None else "")

    title: str
    message: str
    platform_site_id: uuid.UUID | None = Field(
        default=None,
        description="Tenant site for the registered device when device_id is set; otherwise alert.site_id.",
    )
    platform_site_name: str | None = Field(default=None, description="Resolved site name for platform_site_id.")
    platform_device_name: str | None = Field(
        default=None,
        description="Resolved device name when device_id is set (for display without exposing raw IDs).",
    )
    source_component: str | None
    source_object_type: str | None
    source_object_id: uuid.UUID | None
    trace_id: str | None
    acknowledged: bool
    acknowledged_by_user_id: uuid.UUID | None
    acknowledged_at: datetime | None
    created_at: datetime


class AlertListResponse(BaseModel):
    items: list[AlertRead]
    total: int


class AlertAcknowledgeAllResponse(BaseModel):
    acknowledged_count: int


class AlertUnacknowledgedSummary(BaseModel):
    """Header / dashboard — matches implementation guide §6.2 + legacy fields."""

    critical: int = 0
    warning: int = 0
    info: int = 0
    informational: int = Field(
        0,
        description="Unacknowledged alerts with severity informational (DML / audit; not incident-class).",
    )
    total_unacknowledged: int = Field(
        ...,
        description="Unacknowledged operational severities only (info + warning + critical), excludes informational.",
    )
    by_site: dict[str, int] = Field(default_factory=dict)
    has_critical: bool = False
    critical_recent_count: int = 0
