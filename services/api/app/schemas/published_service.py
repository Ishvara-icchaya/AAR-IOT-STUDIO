from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SourceType = Literal["data_object", "result_object"]
PublishProtocol = Literal["mqtt", "rest"]
ServiceStatus = Literal["draft", "active", "stopped", "failed", "inactive"]


class PublishedServiceCreate(BaseModel):
    site_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    source_type: SourceType
    source_object_id: uuid.UUID
    source_object_name: str = Field(..., min_length=1, max_length=200)
    publish_protocol: PublishProtocol
    target_config_json: dict[str, Any] = Field(default_factory=dict)
    status: ServiceStatus = "draft"


class PublishedServiceUpdate(BaseModel):
    site_id: uuid.UUID | None = None
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    source_object_name: str | None = Field(None, min_length=1, max_length=200)
    publish_protocol: PublishProtocol | None = None
    target_config_json: dict[str, Any] | None = None
    status: ServiceStatus | None = None


class PublishedServiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID
    name: str
    description: str | None
    source_type: str
    source_object_id: uuid.UUID
    source_object_name: str
    publish_protocol: str
    target_config_json: dict[str, Any]
    status: str
    last_published_at: datetime | None
    last_error_message: str | None
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PublishedServiceListResponse(BaseModel):
    items: list[PublishedServiceRead]


class PublishedTargetDefaultsResponse(BaseModel):
    """Suggested target_config_json from tenant platform port settings."""

    rest_target_config_json: dict[str, Any]
    mqtt_target_config_json: dict[str, Any]


class PublishedServiceDeliveryLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    published_service_id: uuid.UUID
    source_event_id: uuid.UUID | None
    status: str
    response_code: str | None
    response_message: str | None
    trace_id: str | None
    published_at: datetime


class PublishedServiceDeliveryLogListResponse(BaseModel):
    items: list[PublishedServiceDeliveryLogRead]


class PublishedServiceDetailResponse(BaseModel):
    """Service row plus recent delivery logs for detail UI."""

    service: PublishedServiceRead
    delivery_logs: list[PublishedServiceDeliveryLogRead]


class PublishedServiceTestResponse(BaseModel):
    ok: bool
    status: str
    response_code: str | None = None
    response_message: str | None = None
    trace_id: str | None = None


class DataObjectSourceRef(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    site_id: uuid.UUID
    name: str
    lifecycle_status: str


class ResultObjectSourceRef(BaseModel):
    id: uuid.UUID
    workflow_id: uuid.UUID
    result_object_name: str
    site_id: uuid.UUID


class PublishedServiceSourcesDataObjectsResponse(BaseModel):
    items: list[DataObjectSourceRef]


class PublishedServiceSourcesResultObjectsResponse(BaseModel):
    items: list[ResultObjectSourceRef]
