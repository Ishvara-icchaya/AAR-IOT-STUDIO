from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DashboardCreate(BaseModel):
    site_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    layout: dict[str, Any] = Field(default_factory=dict)


class DashboardUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    site_id: uuid.UUID | None = None
    layout: dict[str, Any] | None = None


class DashboardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    customer_id: uuid.UUID
    site_id: uuid.UUID | None
    name: str
    description: str | None
    status: str
    layout: dict[str, Any]
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    is_primary: bool = False


class DashboardListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID | None
    name: str
    status: str
    updated_at: datetime
    is_primary: bool = False


class DashboardListResponse(BaseModel):
    items: list[DashboardListItem]


class DashboardFreezeResponse(BaseModel):
    id: uuid.UUID
    status: str


class DashboardLiveWidgetBlock(BaseModel):
    widget_id: str
    type: str
    title: str
    data: dict[str, Any] = Field(default_factory=dict)


class DashboardLiveResponse(BaseModel):
    dashboard: dict[str, Any]
    widgets: list[dict[str, Any]]
    rendered_at: str
    primary_dashboard_id: uuid.UUID | None = None


class DataObjectSourceRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    site_id: uuid.UUID
    name: str
    lifecycle_status: str
    updated_at: datetime


class ResultObjectSourceRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_id: uuid.UUID
    result_object_name: str
    site_id: uuid.UUID
    created_at: datetime


class DashboardSourcesDataObjectsResponse(BaseModel):
    items: list[DataObjectSourceRow]


class DashboardSourcesResultObjectsResponse(BaseModel):
    items: list[ResultObjectSourceRow]


class DashboardPreviewBody(BaseModel):
    """Optional layout override for builder preview (unsaved canvas)."""

    layout: dict[str, Any] | None = None


class DashboardShareRequest(BaseModel):
    """Phase 1: site access is implicit; reserved for future ACL rows."""

    user_ids: list[uuid.UUID] = Field(default_factory=list)


class DashboardShareUsersResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)


class ClearPrimaryDashboardResponse(BaseModel):
    """After clear, Enterprise dashboard returns no_primary_dashboard until a new primary is set."""

    primary_dashboard_id: uuid.UUID | None = None


class EnterpriseSiteObjectCountRow(BaseModel):
    site_id: uuid.UUID
    site_name: str
    data_object_count: int
    result_object_count: int
    total_count: int


class EnterpriseSiteObjectCountsResponse(BaseModel):
    items: list[EnterpriseSiteObjectCountRow]
    total: int
    page: int
    page_size: int
