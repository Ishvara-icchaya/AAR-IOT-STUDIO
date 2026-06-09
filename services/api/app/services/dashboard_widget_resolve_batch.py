"""Batch widget resolver: legacy resolve_widget_data → DashboardWidgetPayload envelopes."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.services.permission_service import site_ids_with_permission
from app.core.dashboard_widget_types import (
    INVALID_WIDGET_REFERENCE,
    OPS_ALERT_TRENDS,
    UNSUPPORTED,
    canonical_widget_type,
)
from app.models.dashboard import Dashboard
from app.models.user import User
from app.schemas.dashboard_layout import iter_widgets
from app.schemas.dashboard_widget_runtime import (
    DashboardWidgetPayload,
    DashboardWidgetPayloadMeta,
    DashboardWidgetSource,
    DashboardWidgetsResolveBatchRequest,
    DashboardWidgetsResolveBatchResponse,
    utc_now_iso,
)
from app.services.dashboard_live import resolve_widget_data

MSG_INVALID_WIDGET_REF = "Widget is not part of this dashboard or is no longer available."
MSG_LEGACY_BINDING = "Legacy widget binding is not supported in v2 runtime. Rebind this widget."
MSG_LEGACY_DATA_OBJECT = (
    "Legacy data_object binding is not supported in v2 runtime. Rebind this widget."
)


def _find_widget(layout: dict[str, Any], widget_id: str) -> dict[str, Any] | None:
    for w in iter_widgets(layout):
        wwid = str(w.get("widgetId") or w.get("widget_id") or "")
        if wwid == widget_id:
            return w
    return None


def _binding_source(binding: dict[str, Any]) -> DashboardWidgetSource:
    st = binding.get("sourceType") if binding.get("sourceType") is not None else binding.get("source_type")
    sid = binding.get("siteId") if binding.get("siteId") is not None else binding.get("site_id")
    eid = binding.get("endpointId") if binding.get("endpointId") is not None else binding.get("endpoint_id")
    oname = binding.get("objectName") if binding.get("objectName") is not None else binding.get("object_name")
    return DashboardWidgetSource(
        source_type=str(st or ""),
        site_id=str(sid) if sid is not None else None,
        endpoint_id=str(eid) if eid is not None else None,
        object_name=str(oname) if oname is not None else None,
    )


def _binding_is_data_object(binding: dict[str, Any]) -> bool:
    st = binding.get("sourceType") if binding.get("sourceType") is not None else binding.get("source_type")
    return str(st or "").strip() == "data_object"


def _strip_data_errors_for_client(data: dict[str, Any]) -> dict[str, Any]:
    """Keep payload but omit internal error string from nested data when surfacing as envelope.message."""
    out = dict(data)
    out.pop("error", None)
    return out


def _status_for_legacy_block(
    *,
    block_type: str,
    canonical: str,
    data: dict[str, Any],
) -> tuple[str, str | None, DashboardWidgetPayloadMeta | None]:
    """Derive status, message, meta from legacy resolve_widget_data output."""
    err = data.get("error")
    if isinstance(err, str) and err.strip():
        return "error", err.strip(), None

    degraded = data.get("degraded") is True
    warning = data.get("warning") if isinstance(data.get("warning"), str) else ""

    if block_type == OPS_ALERT_TRENDS or canonical == OPS_ALERT_TRENDS:
        series = data.get("series")
        if isinstance(series, list) and len(series) == 0:
            return "empty", "No trend data available for this time window.", None

    if degraded:
        meta = DashboardWidgetPayloadMeta(warnings=[warning] if warning else [])
        return "degraded", None, meta

    return "ok", None, None


def _resolve_one(
    db: Session,
    *,
    user: User,
    customer_id: uuid.UUID,
    dashboard_site_id: uuid.UUID | None,
    allowed_site_ids: list[uuid.UUID] | None,
    resolved_since: datetime | None,
    widget: dict[str, Any],
    pin_device_version_id: uuid.UUID | None = None,
) -> DashboardWidgetPayload:
    wid = str(widget.get("widgetId") or widget.get("widget_id") or "")
    block_type = str(widget.get("type") or "")
    title = str(widget.get("title") or "")
    binding = widget.get("binding") if isinstance(widget.get("binding"), dict) else {}
    canonical = canonical_widget_type(block_type)
    gen_at = utc_now_iso()
    src = _binding_source(binding)

    if canonical == UNSUPPORTED:
        return DashboardWidgetPayload(
            widget_id=wid,
            widget_type=UNSUPPORTED,
            status="error",
            title=title or None,
            message=MSG_LEGACY_BINDING,
            generated_at=gen_at,
            source=src,
            data=None,
        )

    if _binding_is_data_object(binding):
        return DashboardWidgetPayload(
            widget_id=wid,
            widget_type=canonical,
            status="error",
            title=title or None,
            message=MSG_LEGACY_DATA_OBJECT,
            generated_at=gen_at,
            source=src,
            data=None,
        )

    legacy = resolve_widget_data(
        db,
        customer_id=customer_id,
        widget=widget,
        dashboard_site_id=dashboard_site_id,
        allowed_site_ids=allowed_site_ids,
        resolved_since=resolved_since,
        pin_device_version_id=pin_device_version_id,
    )
    raw_data = legacy.get("data") if isinstance(legacy.get("data"), dict) else {}

    st, msg, meta = _status_for_legacy_block(
        block_type=block_type, canonical=canonical, data=raw_data
    )

    if st == "error":
        payload_data = None
    else:
        payload_data = _strip_data_errors_for_client(raw_data)

    return DashboardWidgetPayload(
        widget_id=wid,
        widget_type=canonical,
        status=st,  # type: ignore[arg-type]
        title=title or None,
        message=msg,
        generated_at=gen_at,
        source=src,
        data=payload_data,
        meta=meta,
    )


def resolve_dashboard_widgets_batch(
    db: Session,
    user: User,
    body: DashboardWidgetsResolveBatchRequest,
) -> DashboardWidgetsResolveBatchResponse:
    d = db.get(Dashboard, body.dashboard_id)
    if not d or d.customer_id != user.customer_id:
        # Whole-request: caller should 404 before this; defensive
        raise ValueError("dashboard not found")

    layout: dict[str, Any] = (
        dict(body.dashboard_layout_draft) if body.dashboard_layout_draft is not None else dict(d.layout or {})
    )

    allowed = site_ids_with_permission(db, user, "dashboards.read")
    resolved_since: datetime | None = None
    if body.scope_hours is not None and body.scope_hours > 0:
        resolved_since = datetime.now(timezone.utc) - timedelta(hours=int(body.scope_hours))

    out: list[DashboardWidgetPayload] = []
    batch_at = utc_now_iso()

    for ref in body.widgets:
        wid = ref.widget_id
        w_def = _find_widget(layout, wid)
        if w_def is None:
            out.append(
                DashboardWidgetPayload(
                    widget_id=wid,
                    widget_type=INVALID_WIDGET_REFERENCE,
                    status="error",
                    message=MSG_INVALID_WIDGET_REF,
                    generated_at=utc_now_iso(),
                    source=DashboardWidgetSource(),
                    data=None,
                )
            )
            continue
        out.append(
            _resolve_one(
                db,
                user=user,
                customer_id=user.customer_id,
                dashboard_site_id=d.site_id,
                allowed_site_ids=allowed,
                resolved_since=resolved_since,
                widget=w_def,
                pin_device_version_id=body.device_version_id,
            )
        )

    return DashboardWidgetsResolveBatchResponse(widgets=out, batch_generated_at=batch_at)
