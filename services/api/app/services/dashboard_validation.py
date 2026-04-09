"""Validate dashboard layout before save/freeze."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.data_object import DataObject
from app.models.device import Device
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.dashboard_layout import iter_widgets

ALLOWED_SOURCE = frozenset({"data_object", "result_object"})
ALLOWED_WIDGET_TYPES = frozenset(
    {
        "table",
        "chart",
        "kpi",
        "device_tile",
        "map",
        "health_summary",
        "alert_summary",
        "text",
        "site_summary",
    }
)
SITE_AGGREGATE_WIDGETS = frozenset({"health_summary", "alert_summary", "site_summary"})


def _bget(b: dict[str, Any], snake: str, camel: str) -> Any:
    return b.get(snake) if b.get(snake) is not None else b.get(camel)


def _cget(cfg: dict[str, Any], snake: str, camel: str, default: Any = None) -> Any:
    v = cfg.get(snake)
    if v is not None:
        return v
    v = cfg.get(camel)
    return default if v is None else v


def validate_layout_for_save(
    *,
    layout: dict[str, Any],
    site_id: uuid.UUID | None,
    require_widgets: bool = False,
) -> list[str]:
    errs: list[str] = []
    widgets = iter_widgets(layout)
    if require_widgets and not layout.get("rows"):
        errs.append("layout must include at least one row")
    for w in widgets:
        t = w.get("type")
        wid = w.get("widgetId") or w.get("widget_id") or "?"
        if t not in ALLOWED_WIDGET_TYPES:
            errs.append(f"unknown widget type: {t}")
        b = w.get("binding") or {}
        cfg = w.get("config") or {}
        if t == "text":
            continue
        if t in SITE_AGGREGATE_WIDGETS:
            continue
        if t == "map":
            lat = _bget(b, "latitude_field", "latitudeField")
            lon = _bget(b, "longitude_field", "longitudeField")
            if not lat or not lon:
                errs.append(f"map widget {wid} requires latitude_field and longitude_field")
            auto = bool(_cget(cfg, "auto_include_gps_objects", "autoIncludeGpsObjects", True))
            if auto:
                if site_id is None:
                    errs.append(f"map widget {wid}: auto GPS requires dashboard site")
            elif not _bget(b, "source_id", "sourceId"):
                errs.append(f"map widget {wid} requires source_id when auto GPS is disabled")
            continue
        st = _bget(b, "source_type", "sourceType")
        if st not in ALLOWED_SOURCE:
            errs.append(f"widget {wid} requires binding source_type data_object|result_object")
            continue
        sid = _bget(b, "source_id", "sourceId")
        if not sid:
            errs.append(f"widget {wid} requires source_id")
    if site_id is None and widgets:
        errs.append("site_id is required when dashboard has widgets")
    return errs


def validate_widgets_for_freeze(*, layout: dict[str, Any]) -> list[str]:
    """Binding completeness for freeze (beyond source existence)."""
    errs: list[str] = []
    for w in iter_widgets(layout):
        t = w.get("type")
        wid = w.get("widgetId") or w.get("widget_id") or "?"
        b = w.get("binding") or {}
        if t == "chart":
            xf = str(_bget(b, "x_field", "xField") or "").strip()
            yf = str(_bget(b, "y_field", "yField") or "").strip()
            if not xf or not yf:
                errs.append(f"chart widget {wid}: x_field and y_field are required for freeze")
        if t == "kpi":
            m = str(_bget(b, "metric", "metric") or "").strip()
            if not m:
                errs.append(f"kpi widget {wid}: metric is required for freeze")
        if t == "table":
            fields = b.get("fields") or b.get("columns")
            if fields is not None:
                if isinstance(fields, str):
                    fields = [fields]
                if isinstance(fields, list):
                    if len(fields) == 0:
                        errs.append(f"table widget {wid}: fields list cannot be empty when set")
                    for f in fields:
                        if not str(f).strip():
                            errs.append(f"table widget {wid}: each field name must be non-empty")
        if t == "device_tile":
            kf = b.get("kpi_fields") or b.get("kpiFields") or []
            if isinstance(kf, str):
                kf = [kf] if kf.strip() else []
            if not kf:
                errs.append(f"device_tile widget {wid}: at least one kpi field is required for freeze")
    return errs


def validate_sources_exist(db: Session, *, customer_id: uuid.UUID, layout: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    for w in iter_widgets(layout):
        t = w.get("type")
        if t in SITE_AGGREGATE_WIDGETS or t == "text":
            continue
        b = w.get("binding") or {}
        cfg = w.get("config") or {}
        if t == "map" and bool(_cget(cfg, "auto_include_gps_objects", "autoIncludeGpsObjects", True)):
            continue
        st = _bget(b, "source_type", "sourceType")
        sid_raw = _bget(b, "source_id", "sourceId")
        if not sid_raw or st not in ALLOWED_SOURCE:
            continue
        try:
            sid = uuid.UUID(str(sid_raw))
        except ValueError:
            errs.append(f"invalid source_id on widget {w.get('widgetId')}")
            continue
        if st == "data_object":
            row = db.get(DataObject, sid)
            if not row or row.customer_id != customer_id:
                errs.append(f"data_object {sid} not found")
        else:
            row = db.get(WorkflowResultObject, sid)
            if not row or row.customer_id != customer_id:
                errs.append(f"result_object {sid} not found")
    return errs


def validate_site_coherence(
    *,
    dashboard_site_id: uuid.UUID | None,
    layout: dict[str, Any],
    db: Session,
    customer_id: uuid.UUID,
) -> list[str]:
    errs: list[str] = []
    if dashboard_site_id is None:
        return errs
    for w in iter_widgets(layout):
        b = w.get("binding") or {}
        st = _bget(b, "source_type", "sourceType")
        sid_raw = _bget(b, "source_id", "sourceId")
        if not sid_raw or st != "data_object":
            continue
        try:
            sid = uuid.UUID(str(sid_raw))
        except ValueError:
            continue
        row = db.get(DataObject, sid)
        if not row:
            continue
        dev = db.get(Device, row.device_id)
        if dev and dev.site_id != dashboard_site_id:
            errs.append(
                f"widget {w.get('widgetId')}: data_object site does not match dashboard site"
            )
    return errs
