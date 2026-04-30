"""Pydantic models for dashboard widget runtime contract (camelCase JSON)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

WidgetPayloadStatus = Literal["ok", "empty", "degraded", "error"]


class DashboardWidgetSource(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    source_type: str = Field(
        default="",
        validation_alias="sourceType",
        serialization_alias="sourceType",
    )
    site_id: str | None = Field(
        default=None,
        validation_alias="siteId",
        serialization_alias="siteId",
    )
    endpoint_id: str | None = Field(
        default=None,
        validation_alias="endpointId",
        serialization_alias="endpointId",
    )
    object_name: str | None = Field(
        default=None,
        validation_alias="objectName",
        serialization_alias="objectName",
    )


class DashboardWidgetPayloadMeta(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    warnings: list[str] | None = None
    empty_reason: str | None = Field(
        default=None,
        validation_alias="emptyReason",
        serialization_alias="emptyReason",
    )
    latency_ms: float | None = Field(
        default=None,
        validation_alias="latencyMs",
        serialization_alias="latencyMs",
    )


class DashboardWidgetPayload(BaseModel):
    """Single widget result in resolve-batch (see DASHBOARD_WIDGET_CONTRACT.md)."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    widget_id: str = Field(
        ...,
        validation_alias="widgetId",
        serialization_alias="widgetId",
    )
    widget_type: str = Field(
        ...,
        validation_alias="widgetType",
        serialization_alias="widgetType",
    )
    status: WidgetPayloadStatus
    title: str | None = None
    subtitle: str | None = None
    message: str | None = None
    generated_at: str = Field(
        ...,
        validation_alias="generatedAt",
        serialization_alias="generatedAt",
    )
    source: DashboardWidgetSource = Field(default_factory=DashboardWidgetSource)
    data: Any = None
    meta: DashboardWidgetPayloadMeta | None = None


class DashboardWidgetsResolveBatchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    widgets: list[DashboardWidgetPayload]
    batch_generated_at: str = Field(
        ...,
        validation_alias="batchGeneratedAt",
        serialization_alias="batchGeneratedAt",
    )


class ResolveBatchWidgetRef(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    widget_id: str = Field(
        ...,
        validation_alias="widgetId",
        serialization_alias="widgetId",
    )


class DashboardWidgetsResolveBatchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    dashboard_id: uuid.UUID = Field(
        ...,
        validation_alias="dashboardId",
        serialization_alias="dashboardId",
    )
    widgets: list[ResolveBatchWidgetRef]
    dashboard_layout_draft: dict[str, Any] | None = Field(
        default=None,
        validation_alias="dashboardLayoutDraft",
        serialization_alias="dashboardLayoutDraft",
    )
    scope_hours: int | None = Field(
        default=None,
        ge=1,
        le=24 * 60,
        validation_alias="scopeHours",
        serialization_alias="scopeHours",
    )


class DashboardRuntimeDashboardMeta(BaseModel):
    """Dashboard shell for runtime-layout (layout + config only, no widget data)."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    id: str
    name: str
    description: str | None = None
    status: str
    site_id: str | None = Field(
        default=None,
        validation_alias="siteId",
        serialization_alias="siteId",
    )
    layout: dict[str, Any]
    settings: dict[str, Any] = Field(default_factory=dict)


class DashboardRuntimeLayoutResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    dashboard: DashboardRuntimeDashboardMeta
    rendered_at: str = Field(
        ...,
        validation_alias="renderedAt",
        serialization_alias="renderedAt",
    )


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
