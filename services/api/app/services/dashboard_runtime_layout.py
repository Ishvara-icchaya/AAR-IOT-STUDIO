"""Layout + widget definitions only (no resolved widget data) for runtime-layout API."""

from __future__ import annotations

import uuid
from typing import Any

from app.core.dashboard_runtime import merge_layout_settings
from app.schemas.dashboard_widget_runtime import (
    DashboardRuntimeDashboardMeta,
    DashboardRuntimeLayoutResponse,
    utc_now_iso,
)


def build_runtime_layout_response(
    *,
    dashboard_id: uuid.UUID,
    name: str,
    description: str | None,
    status: str,
    site_id: uuid.UUID | None,
    layout: dict[str, Any],
) -> DashboardRuntimeLayoutResponse:
    """Same dashboard shell shape as live payload `dashboard` minus widgets."""
    layout_use = dict(layout or {})
    settings = merge_layout_settings(layout_use)
    dash = DashboardRuntimeDashboardMeta(
        id=str(dashboard_id),
        name=name,
        description=description,
        status=status,
        site_id=str(site_id) if site_id else None,
        layout=layout_use,
        settings=settings if isinstance(settings, dict) else {},
    )
    return DashboardRuntimeLayoutResponse(dashboard=dash, rendered_at=utc_now_iso())
