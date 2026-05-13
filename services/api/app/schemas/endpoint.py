"""Pydantic schemas for v2 ingest endpoints and read models."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EndpointCreate(BaseModel):
    site_id: uuid.UUID
    endpoint_name: str = Field(..., min_length=1, max_length=255)
    protocol: str = Field(..., min_length=1, max_length=32, description="Transport: mqtt, http, coap, ws, …")
    primary_device_key_fields: list[str] | None = Field(
        None,
        description="If set, stored in identity_draft only until POST …/publish-identity (never activates alone).",
    )
    device_label_fields: list[str] | None = None
    location_fields: dict[str, Any] | list[Any] | None = None
    auth_config: dict[str, Any] | None = None
    device_endpoint_id: uuid.UUID | None = None
    enabled: bool = True


class EndpointUpdate(BaseModel):
    endpoint_name: str | None = Field(None, min_length=1, max_length=255)
    protocol: str | None = Field(None, min_length=1, max_length=32)
    primary_device_key_fields: list[str] | None = Field(
        None,
        description="Updates identity_draft only; use publish-identity to activate.",
    )
    device_label_fields: list[str] | None = None
    location_fields: dict[str, Any] | list[Any] | None = None
    identity_draft: dict[str, Any] | None = Field(
        None,
        description="Partial merge into identity_draft (primary_device_key_fields, device_label_fields, location_fields).",
    )
    auth_config: dict[str, Any] | None = None
    device_endpoint_id: uuid.UUID | None = None
    enabled: bool | None = None


class EndpointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    endpoint_name: str
    protocol: str
    object_name: str
    lifecycle_status: str
    primary_device_key_fields: list[Any] | None
    device_label_fields: list[Any] | None
    location_fields: dict[str, Any] | list[Any] | None
    auth_config: dict[str, Any] | None
    device_endpoint_id: uuid.UUID | None
    sample_payload: dict[str, Any] | list[Any] | None = None
    sample_ingested_at: datetime | None = None
    identity_published_at: datetime | None = None
    identity_draft: dict[str, Any] | None = None
    enabled: bool
    created_at: datetime
    updated_at: datetime


class EndpointListResponse(BaseModel):
    items: list[EndpointRead]


class ScrubberIdentityHintsResponse(BaseModel):
    """Paths from linked device `device_objects.mapping.scrubber2.fieldSemantics` (identity / display roles)."""

    primary_device_key_fields: list[str]
    device_label_fields: list[str]


class ResolvedDeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    endpoint_id: uuid.UUID
    object_name: str
    primary_key_hash: str
    primary_key_json: dict[str, Any]
    device_label: str | None
    device_type: str | None
    last_seen_at: datetime | None
    lifecycle_status: str
    health_status: str | None
    created_at: datetime
    updated_at: datetime


class ResolvedDeviceListResponse(BaseModel):
    items: list[ResolvedDeviceRead]


class ScrubbedEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    endpoint_id: uuid.UUID
    resolved_device_id: uuid.UUID
    object_name: str
    event_ts: datetime
    ingested_at: datetime
    identity_json: dict[str, Any]
    display_json: dict[str, Any]
    kpi_json: dict[str, Any]
    health_json: dict[str, Any] | None
    location_json: dict[str, Any] | None
    payload_ref: str | None
    created_at: datetime


class ScrubbedEventListResponse(BaseModel):
    items: list[ScrubbedEventRead]
    next_cursor: str | None = Field(None, description="scrubbed_events.id for the next page")


class LatestDeviceStateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    endpoint_id: uuid.UUID
    resolved_device_id: uuid.UUID
    object_name: str
    last_event_ts: datetime | None
    last_ingested_at: datetime | None
    lifecycle_status: str
    health_status: str | None
    identity_json: dict[str, Any]
    display_json: dict[str, Any]
    kpi_json: dict[str, Any]
    health_json: dict[str, Any] | None
    location_json: dict[str, Any] | None
    system_json: dict[str, Any] = Field(default_factory=dict)
    scrubbed_event_id: uuid.UUID | None
    updated_at: datetime


class LatestDeviceStateListResponse(BaseModel):
    items: list[LatestDeviceStateRead]


class MapMarkerRead(BaseModel):
    resolved_device_id: uuid.UUID
    latest_device_state_id: uuid.UUID
    object_name: str
    latitude: float
    longitude: float
    heading: float | None = None
    updated_at: datetime
    identity_json: dict[str, Any]
    display_json: dict[str, Any]
    kpi_json: dict[str, Any]
    health_json: dict[str, Any] | None


class MapMarkerListResponse(BaseModel):
    items: list[MapMarkerRead]
