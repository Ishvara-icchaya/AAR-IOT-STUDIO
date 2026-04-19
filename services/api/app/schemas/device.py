import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.endpoint_activation import ACTIVATION_STATUS_DESCRIPTION


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    icon: str | None = Field(None, max_length=512)
    site_id: uuid.UUID


class DeviceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    icon: str | None = Field(None, max_length=512)
    site_id: uuid.UUID | None = None
    is_active: bool | None = None
    polling_enabled: bool | None = None


class DeviceEndpointNested(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    protocol: str
    config: dict[str, Any]
    polling_interval_seconds: int
    is_active: bool
    last_verified_at: datetime | None = None
    validation_status: str | None = None
    validation_detail: str | None = None
    activation_status: str = Field(default="configured", description=ACTIVATION_STATUS_DESCRIPTION)
    first_payload_at: datetime | None = None
    last_payload_at: datetime | None = None
    last_error: str | None = None


class DeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    name: str
    description: str | None
    icon: str | None
    is_active: bool
    polling_enabled: bool
    last_seen_at: datetime | None = None
    current_liveness_state: str = "waiting_for_first_payload"
    last_state_changed_at: datetime | None = None
    last_alerted_state: str | None = None
    expected_interval_seconds: int = 60
    late_threshold_seconds: int = 120
    offline_threshold_seconds: int = 300
    endpoint: DeviceEndpointNested | None = None


class DeviceListResponse(BaseModel):
    items: list[DeviceRead]


class DeviceDeleteFrozenDashboardRef(BaseModel):
    id: str
    name: str


class DeviceDeleteResponse(BaseModel):
    """Device delete always succeeds when not blocked; includes transparency when frozen dashboards still bound this device."""

    warning: str | None = None
    frozen_dashboard_count: int = 0
    frozen_dashboards: list[DeviceDeleteFrozenDashboardRef] = Field(default_factory=list)


