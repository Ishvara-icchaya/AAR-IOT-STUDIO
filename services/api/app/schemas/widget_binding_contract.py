"""Frozen widget binding shape for dashboard layout JSON (v1).

Persist under dashboards.layout.widgets[].binding (or equivalent) as JSON.
Changes require a version suffix on the parent layout object.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.core.widget_binding_contract import (
    WidgetRepresentationV1,
    WidgetSourceTypeV1,
)


class FieldMappingEntryV1(BaseModel):
    """Maps a location inside source payload_json to a widget slot / column."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    source_path: str = Field(
        ...,
        description="Dot path or JSON Pointer into the source record payload (e.g. temperature or /metrics/rpm).",
        min_length=1,
        max_length=512,
    )
    target_key: str = Field(
        ...,
        description="Widget-internal key: table column id, series id, tile field, etc.",
        min_length=1,
        max_length=128,
    )


class HealthBindingV1(BaseModel):
    """Paths into source payload used for health visualization."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    status_path: str | None = Field(None, max_length=512)
    severity_path: str | None = Field(None, max_length=512)
    code_path: str | None = Field(None, max_length=512)
    message_path: str | None = Field(None, max_length=512)


class KpiBindingEntryV1(BaseModel):
    """Numeric KPI mapping for chart / kpi / map widgets."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    value_path: str = Field(..., min_length=1, max_length=512)
    key: str | None = Field(None, max_length=128, description="Stable series key for charts")
    label: str | None = Field(None, max_length=255, description="Human label")


class WidgetBindingV1(BaseModel):
    """Single widget's data binding. source_id is data_objects.id or workflow_result_objects.id."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    source_type: WidgetSourceTypeV1
    source_id: uuid.UUID
    representation: WidgetRepresentationV1
    field_mapping: tuple[FieldMappingEntryV1, ...] = Field(default_factory=tuple)
    health_binding: HealthBindingV1 | None = None
    kpi_binding: tuple[KpiBindingEntryV1, ...] = Field(default_factory=tuple)
