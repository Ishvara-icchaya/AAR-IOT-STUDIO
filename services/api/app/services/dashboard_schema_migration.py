from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def migrate_legacy_layout_to_grid(layout: dict[str, Any] | None) -> dict[str, Any]:
    """Compatibility helper for schema_version=1 dashboards.

    Converts legacy row/column layout payload into a basic RGL-compatible shape.
    This helper is additive and can be called by future runtime-definition endpoints.
    """
    rows = layout.get("rows") if isinstance(layout, dict) else None
    if not isinstance(rows, list):
        return {"layouts": {"lg": [], "md": [], "sm": []}, "widgets": [], "schema_version": 2}

    lg: list[dict[str, Any]] = []
    widgets: list[dict[str, Any]] = []
    cursor_y = 0

    for ri, row in enumerate(rows):
        cols = row.get("columns") if isinstance(row, dict) else None
        if not isinstance(cols, list):
            cursor_y += 7
            continue
        cursor_x = 0
        for ci, col in enumerate(cols):
            if not isinstance(col, dict):
                continue
            span = int(col.get("span") or 12)
            span = max(1, min(12, span))
            widget = col.get("widget") if isinstance(col.get("widget"), dict) else {}
            widget_id = str(widget.get("widgetId") or f"v2-w-{ri}-{ci}")
            widget_type = str(widget.get("type") or "text")
            lg.append({"i": widget_id, "x": cursor_x, "y": cursor_y, "w": span, "h": 4, "minW": 2, "minH": 2})
            widgets.append(
                {
                    "id": widget_id,
                    "type": widget_type,
                    "title": str(widget.get("title") or "Widget"),
                    "binding": widget.get("binding") if isinstance(widget.get("binding"), dict) else {},
                    "config": widget.get("config") if isinstance(widget.get("config"), dict) else {},
                    "createdAt": _now_iso(),
                    "updatedAt": _now_iso(),
                }
            )
            cursor_x += span
        cursor_y += 7

    return {
        "schema_version": 2,
        "layouts": {
            "lg": lg,
            "md": [{**item, "w": min(item["w"], 8), "x": min(item["x"], 8)} for item in lg],
            "sm": [{**item, "w": min(item["w"], 4), "x": min(item["x"], 4)} for item in lg],
        },
        "widgets": widgets,
    }
