"""Frozen vocabulary for dashboard widget bindings (v1).

Use these literals/enums when persisting widget config under dashboards.layout
or validating dashboard JSON.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

WIDGET_SOURCE_TYPES_V1: tuple[str, ...] = ("data_object", "result_object")
WidgetSourceTypeV1 = Literal["data_object", "result_object"]

WIDGET_REPRESENTATIONS_V1: tuple[str, ...] = (
    "table",
    "chart",
    "kpi",
    "map",
    "device_tile",
)
WidgetRepresentationV1 = Literal["table", "chart", "kpi", "map", "device_tile"]


class WidgetSourceType(str, Enum):
    """Enum mirror of WidgetSourceTypeV1 for OpenAPI / strict parsing."""

    DATA_OBJECT = "data_object"
    RESULT_OBJECT = "result_object"


class WidgetRepresentation(str, Enum):
    """Enum mirror of WidgetRepresentationV1."""

    TABLE = "table"
    CHART = "chart"
    KPI = "kpi"
    MAP = "map"
    DEVICE_TILE = "device_tile"
