import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.endpoint_activation import ACTIVATION_STATUS_DESCRIPTION


class DeviceEndpointCreate(BaseModel):
    device_id: uuid.UUID
    protocol: str = Field(min_length=1, max_length=64)
    config: dict[str, Any] = Field(default_factory=dict)
    polling_interval_seconds: int = Field(
        default=60,
        ge=0,
        le=86400,
        description="0 = real-time / minimum scheduler cadence when supported",
    )
    is_active: bool = True


class DeviceEndpointUpdate(BaseModel):
    protocol: str | None = Field(None, min_length=1, max_length=64)
    config: dict[str, Any] | None = None
    polling_interval_seconds: int | None = Field(None, ge=0, le=86400)
    is_active: bool | None = None


class DeviceEndpointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    protocol: str
    config: dict[str, Any]
    polling_interval_seconds: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_verified_at: datetime | None = None
    validation_status: str | None = None
    validation_detail: str | None = None
    activation_status: str = Field(description=ACTIVATION_STATUS_DESCRIPTION)
    first_payload_at: datetime | None = None
    last_payload_at: datetime | None = None
    last_error: str | None = None


class DeviceEndpointObservability(BaseModel):
    """Unified envelope; protocol-specific fields live in ``details``."""

    last_raw_ingested_at: str | None = None
    protocol: str = Field(
        description="Logical protocol: mqtt | rest | coap | websocket (HTTP endpoints use rest).",
    )
    details: dict[str, Any] = Field(default_factory=dict)
    payload_receipt_status: str = Field(
        default="none",
        description="none: no archived raw yet; fresh: within timeliness window; stale: exceeds window.",
    )
    payload_age_seconds: int | None = Field(
        default=None,
        description="Seconds since latest raw archive when status is fresh or stale.",
    )
    payload_receipt_threshold_seconds: int | None = Field(
        default=None,
        description="Staleness threshold used (device late threshold, or max with REST Pull cadence).",
    )


class DeviceEndpointGetResponse(BaseModel):
    defined: bool
    endpoint: DeviceEndpointRead | None = None
    observability: DeviceEndpointObservability | None = None


class DeviceEndpointValidateRequest(BaseModel):
    device_id: uuid.UUID


class DeviceEndpointValidateResponse(BaseModel):
    validation_status: str
    validation_detail: str
    last_verified_at: datetime
    observability: DeviceEndpointObservability
    endpoint: DeviceEndpointRead
