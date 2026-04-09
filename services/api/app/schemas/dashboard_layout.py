"""Layout JSON stored in dashboards.layout (versioned)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DashboardWidgetSlotV1(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    widget_id: str = Field(..., validation_alias="widgetId", serialization_alias="widgetId")
    type: str
    title: str = ""
    binding: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)


class DashboardColumnV1(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    column_id: str = Field(..., validation_alias="columnId", serialization_alias="columnId")
    span: int = 12
    widget: DashboardWidgetSlotV1 | None = None


class DashboardRowV1(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    row_id: str = Field(..., validation_alias="rowId", serialization_alias="rowId")
    columns: list[DashboardColumnV1] = Field(default_factory=list)


class DashboardLayoutV1(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    version: int = 1
    rows: list[DashboardRowV1] = Field(default_factory=list)


def iter_widgets(layout: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten widgets from raw layout dict (tolerates missing structure)."""
    out: list[dict[str, Any]] = []
    if not isinstance(layout, dict):
        return out
    for row in layout.get("rows") or []:
        if not isinstance(row, dict):
            continue
        for col in row.get("columns") or []:
            if not isinstance(col, dict):
                continue
            w = col.get("widget")
            if isinstance(w, dict):
                out.append(w)
    return out
