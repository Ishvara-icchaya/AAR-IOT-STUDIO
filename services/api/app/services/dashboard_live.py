"""Resolve dashboard layout → widget payloads (single entry for live/preview data)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.site import Site
from app.models.workflow_result_object import WorkflowResultObject
from app.core.dashboard_runtime import merge_layout_settings
from app.schemas.dashboard_layout import iter_widgets
from app.services.dashboard_health import derive_blink_mode, extract_health_fields


def _bget(b: dict[str, Any], snake: str, camel: str) -> Any:
    v = b.get(snake)
    return v if v is not None else b.get(camel)


def _cget(cfg: dict[str, Any], snake: str, camel: str, default: Any = None) -> Any:
    v = cfg.get(snake)
    if v is not None:
        return v
    v = cfg.get(camel)
    return default if v is None else v


def _get_path(obj: Any, path: str) -> Any:
    cur: Any = obj
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _coerce_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _extract_lat_lon(payload: dict[str, Any], latf: str, lonf: str) -> tuple[float | None, float | None]:
    lat = _coerce_float(_get_path(payload, latf))
    lon = _coerce_float(_get_path(payload, lonf))
    if lat is None:
        lat = _coerce_float(payload.get(latf))
    if lon is None:
        lon = _coerce_float(payload.get(lonf))
    if lat is None:
        lat = _coerce_float(_get_path(payload, "gps.lat"))
    if lon is None:
        lon = _coerce_float(_get_path(payload, "gps.lon"))
    return lat, lon


def _load_source_record(
    db: Session,
    *,
    customer_id: uuid.UUID,
    source_type: str,
    source_id: uuid.UUID,
) -> tuple[dict[str, Any] | None, datetime | None, str | None]:
    """Returns (flat_payload, updated_at, display_name)."""
    if source_type == "data_object":
        row = db.get(DataObject, source_id)
        if not row or row.customer_id != customer_id:
            return None, None, None
        payload = dict(row.payload or {})
        payload["_kpi"] = dict(row.kpi_json or {})
        if row.health_status:
            payload["health_status"] = row.health_status
        if row.health_message:
            payload["health_message"] = row.health_message
        return payload, row.updated_at, row.name
    row = db.get(WorkflowResultObject, source_id)
    if not row or row.customer_id != customer_id:
        return None, None, None
    p = dict(row.payload_json or {})
    if row.health_status:
        p["health_status"] = row.health_status
    return p, row.created_at, row.result_object_name


def _table_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("rows", "items", "records", "data", "history", "points", "series"):
        v = payload.get(key)
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return list(v)
    if isinstance(payload.get("values"), list):
        return [{"value": x} for x in payload["values"]]
    return [dict(payload)] if isinstance(payload, dict) else []


def _chart_series(payload: dict[str, Any], xf: str, yf: str) -> dict[str, Any]:
    pts = payload.get("points") or payload.get("series")
    if isinstance(pts, list) and pts and isinstance(pts[0], dict):
        xs = [_get_path(p, xf) if _get_path(p, xf) is not None else p.get(xf) for p in pts]
        ys = [_get_path(p, yf) if _get_path(p, yf) is not None else p.get(yf) for p in pts]
        return {"x": xs, "y": ys}
    xv = _get_path(payload, xf)
    yv = _get_path(payload, yf)
    if xv is None:
        xv = payload.get(xf)
    if yv is None:
        yv = payload.get(yf)
    if isinstance(xv, list) and isinstance(yv, list) and len(xv) == len(yv):
        return {"x": list(xv), "y": list(yv)}
    return {"x": [xv], "y": [yv]}


def _aggregate_health_site(
    db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID
) -> dict[str, int]:
    counts = {"green": 0, "yellow": 0, "red": 0, "offline": 0}
    stmt = (
        select(DataObject, Device.is_active)
        .join(Device, DataObject.device_id == Device.id)
        .where(
            DataObject.customer_id == customer_id,
            DataObject.site_id == site_id,
        )
    )
    for do, dev_active in db.execute(stmt).all():
        if not dev_active:
            counts["offline"] += 1
            continue
        hs = (do.health_status or "green").strip().lower()
        if hs in counts:
            counts[hs] += 1
    rstmt = select(WorkflowResultObject.health_status).where(
        WorkflowResultObject.customer_id == customer_id,
        WorkflowResultObject.site_id == site_id,
    )
    for (hs,) in db.execute(rstmt).all():
        key = (hs or "green").strip().lower()
        if key in counts:
            counts[key] += 1
    return counts


def _aggregate_alerts_site(
    db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID
) -> dict[str, Any]:
    active_stmt = (
        select(Alert.severity, func.count(Alert.id))
        .where(
            Alert.customer_id == customer_id,
            Alert.site_id == site_id,
            Alert.acknowledged.is_(False),
        )
        .group_by(Alert.severity)
    )
    by_sev: dict[str, int] = {}
    for sev, cnt in db.execute(active_stmt).all():
        by_sev[str(sev)] = int(cnt)
    recent_stmt = (
        select(Alert)
        .where(
            Alert.customer_id == customer_id,
            Alert.site_id == site_id,
        )
        .order_by(Alert.created_at.desc())
        .limit(20)
    )
    recent: list[dict[str, Any]] = []
    for a in db.scalars(recent_stmt).all():
        recent.append(
            {
                "id": str(a.id),
                "severity": a.severity,
                "title": a.title,
                "acknowledged": a.acknowledged,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
        )
    unack = int(sum(by_sev.values()))
    return {
        "active_by_severity": by_sev,
        "recent": recent,
        "unacknowledged_count": unack,
    }


def _site_summary(
    db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID
) -> dict[str, Any]:
    site = db.get(Site, site_id)
    if not site or site.customer_id != customer_id:
        return {"site_name": None, "device_count": 0, "data_object_count": 0}
    dev_n = db.scalar(
        select(func.count(Device.id)).where(Device.site_id == site_id, Device.customer_id == customer_id)
    )
    do_n = db.scalar(
        select(func.count(DataObject.id)).where(
            DataObject.site_id == site_id, DataObject.customer_id == customer_id
        )
    )
    return {
        "site_name": site.name,
        "device_count": int(dev_n or 0),
        "data_object_count": int(do_n or 0),
    }


def _map_markers_site(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    latf: str,
    lonf: str,
    kpi_fields: list[str],
    excluded: set[str],
    title_field: str | None,
    health_field: str | None,
) -> list[dict[str, Any]]:
    markers: list[dict[str, Any]] = []
    stmt_do = select(DataObject).where(
        DataObject.customer_id == customer_id,
        DataObject.site_id == site_id,
    )
    for row in db.scalars(stmt_do).all():
        sid = str(row.id)
        if sid in excluded:
            continue
        payload = dict(row.payload or {})
        payload["_kpi"] = dict(row.kpi_json or {})
        if row.health_status:
            payload["health_status"] = row.health_status
        lat, lon = _extract_lat_lon(payload, latf, lonf)
        if lat is None or lon is None:
            continue
        device = db.get(Device, row.device_id)
        device_name = device.name if device else None
        site = db.get(Site, row.site_id)
        site_name = site.name if site else None
        hf_source = payload
        if health_field and health_field != "health_status":
            hf_source = {**payload, "health_status": _get_path(payload, health_field)}
        hf = extract_health_fields(hf_source)
        if isinstance(hf.get("health_status"), str) is False and row.health_status:
            hf["health_status"] = row.health_status
        blink = derive_blink_mode(
            health_status=hf.get("health_status") if isinstance(hf.get("health_status"), str) else None,
            health_blink=hf.get("health_blink") if isinstance(hf.get("health_blink"), bool) else None,
            health_severity=hf.get("health_severity") if isinstance(hf.get("health_severity"), int) else None,
            offline=hf.get("offline") if isinstance(hf.get("offline"), bool) else None,
        )
        kpis: dict[str, Any] = {}
        merged = {**payload, **payload.get("_kpi", {})}
        for k in kpi_fields:
            kpis[str(k)] = _get_path(merged, str(k))
        title = row.name
        if title_field:
            tv = _get_path(payload, title_field)
            if tv is not None:
                title = str(tv)
        hmsg = row.health_message or payload.get("health_message")
        markers.append(
            {
                "source_type": "data_object",
                "source_id": sid,
                "display_name": title,
                "device_name": device_name,
                "site_name": site_name,
                "latitude": lat,
                "longitude": lon,
                "kpis": kpis,
                "health_status": hf.get("health_status") or row.health_status,
                "health_message": str(hmsg) if hmsg else None,
                "blink_mode": blink,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
        )

    stmt_ro = select(WorkflowResultObject).where(
        WorkflowResultObject.customer_id == customer_id,
        WorkflowResultObject.site_id == site_id,
    )
    for row in db.scalars(stmt_ro).all():
        sid = str(row.id)
        if sid in excluded:
            continue
        payload = dict(row.payload_json or {})
        if row.health_status:
            payload["health_status"] = row.health_status
        lat, lon = _extract_lat_lon(payload, latf, lonf)
        if lat is None or lon is None:
            continue
        site = db.get(Site, row.site_id)
        site_name = site.name if site else None
        hf = extract_health_fields(payload)
        blink = derive_blink_mode(
            health_status=hf.get("health_status") if isinstance(hf.get("health_status"), str) else None,
            health_blink=hf.get("health_blink") if isinstance(hf.get("health_blink"), bool) else None,
            health_severity=hf.get("health_severity") if isinstance(hf.get("health_severity"), int) else None,
            offline=hf.get("offline") if isinstance(hf.get("offline"), bool) else None,
        )
        kpis = {str(k): _get_path(payload, str(k)) for k in kpi_fields}
        title = row.result_object_name
        if title_field:
            tv = _get_path(payload, title_field)
            if tv is not None:
                title = str(tv)
        hmsg = payload.get("health_message")
        markers.append(
            {
                "source_type": "result_object",
                "source_id": sid,
                "display_name": title,
                "device_name": None,
                "site_name": site_name,
                "latitude": lat,
                "longitude": lon,
                "kpis": kpis,
                "health_status": hf.get("health_status") or row.health_status,
                "health_message": str(hmsg) if hmsg else None,
                "blink_mode": blink,
                "updated_at": row.created_at.isoformat() if row.created_at else None,
            }
        )
    return markers


def resolve_widget_data(
    db: Session,
    *,
    customer_id: uuid.UUID,
    widget: dict[str, Any],
    dashboard_site_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    wtype = str(widget.get("type") or "")
    title = str(widget.get("title") or "")
    wid = str(widget.get("widgetId") or widget.get("widget_id") or "")
    binding = widget.get("binding") or {}
    config = widget.get("config") or {}

    if wtype == "text":
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": {"body": config.get("body") or config.get("text") or ""},
        }

    if wtype == "health_summary":
        if not dashboard_site_id:
            return {
                "widget_id": wid,
                "type": wtype,
                "title": title,
                "data": {
                    "counts": {"green": 0, "yellow": 0, "red": 0, "offline": 0},
                    "blink_mode": "none",
                    "degraded": True,
                    "warning": "Dashboard has no site; health aggregate unavailable.",
                },
            }
        counts = _aggregate_health_site(db, customer_id=customer_id, site_id=dashboard_site_id)
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": {"counts": counts, "blink_mode": "none"},
        }

    if wtype == "alert_summary":
        if not dashboard_site_id:
            return {
                "widget_id": wid,
                "type": wtype,
                "title": title,
                "data": {
                    "active_by_severity": {},
                    "recent": [],
                    "unacknowledged_count": 0,
                    "blink_mode": "none",
                    "degraded": True,
                    "warning": "Dashboard has no site; alerts unavailable.",
                },
            }
        agg = _aggregate_alerts_site(db, customer_id=customer_id, site_id=dashboard_site_id)
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": {**agg, "blink_mode": "slow" if agg["unacknowledged_count"] else "none"},
        }

    if wtype == "site_summary":
        if not dashboard_site_id:
            return {
                "widget_id": wid,
                "type": wtype,
                "title": title,
                "data": {
                    "site_name": None,
                    "device_count": 0,
                    "data_object_count": 0,
                    "blink_mode": "none",
                    "degraded": True,
                    "warning": "Dashboard has no site; site summary unavailable.",
                },
            }
        summ = _site_summary(db, customer_id=customer_id, site_id=dashboard_site_id)
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": {**summ, "blink_mode": "none"},
        }

    st = _bget(binding, "source_type", "sourceType")
    sid_raw = _bget(binding, "source_id", "sourceId")

    if wtype == "map":
        latf = str(_bget(binding, "latitude_field", "latitudeField") or "gps.lat")
        lonf = str(_bget(binding, "longitude_field", "longitudeField") or "gps.lon")
        auto = bool(_cget(config, "auto_include_gps_objects", "autoIncludeGpsObjects", True))
        excluded_raw = config.get("excluded_source_ids") or config.get("excludedSourceIds") or []
        excluded = {str(x) for x in excluded_raw}
        kpi_fields = binding.get("kpi_fields") or binding.get("kpiFields") or []
        if isinstance(kpi_fields, str):
            kpi_fields = [kpi_fields]
        kpi_fields = [str(k) for k in kpi_fields]
        title_field = binding.get("title_field") or binding.get("titleField")
        title_field = str(title_field) if title_field else None
        health_field = binding.get("health_field") or binding.get("healthField")
        health_field = str(health_field) if health_field else None

        if auto and dashboard_site_id:
            markers = _map_markers_site(
                db,
                customer_id=customer_id,
                site_id=dashboard_site_id,
                latf=latf,
                lonf=lonf,
                kpi_fields=kpi_fields,
                excluded=excluded,
                title_field=title_field,
                health_field=health_field,
            )
            data: dict[str, Any] = {
                "mode": "multi",
                "latitude_field": latf,
                "longitude_field": lonf,
                "markers": markers,
            }
            if len(markers) == 0:
                data["degraded"] = True
                data["warning"] = (
                    "No GPS-capable objects for this site with the configured latitude/longitude fields."
                )
            return {
                "widget_id": wid,
                "type": wtype,
                "title": title,
                "data": data,
            }

        if not st or not sid_raw:
            return {
                "widget_id": wid,
                "type": wtype,
                "title": title,
                "data": {"error": "missing source binding (or enable auto GPS with a dashboard site)"},
            }
        try:
            sid = uuid.UUID(str(sid_raw))
        except ValueError:
            return {
                "widget_id": wid,
                "type": wtype,
                "title": title,
                "data": {"error": "invalid source_id"},
            }
        payload, updated_at, display_name = _load_source_record(
            db, customer_id=customer_id, source_type=str(st), source_id=sid
        )
        if payload is None:
            return {
                "widget_id": wid,
                "type": wtype,
                "title": title,
                "data": {
                    "degraded": True,
                    "warning": "Bound source no longer exists or is not accessible.",
                    "source_missing": True,
                    "mode": "single",
                },
            }
        lat, lon = _extract_lat_lon(payload, latf, lonf)
        hf = extract_health_fields(payload)
        blink = derive_blink_mode(
            health_status=hf.get("health_status") if isinstance(hf.get("health_status"), str) else None,
            health_blink=hf.get("health_blink") if isinstance(hf.get("health_blink"), bool) else None,
            health_severity=hf.get("health_severity") if isinstance(hf.get("health_severity"), int) else None,
            offline=hf.get("offline") if isinstance(hf.get("offline"), bool) else None,
        )
        kpis = {str(k): _get_path({**payload, **payload.get("_kpi", {})}, str(k)) for k in kpi_fields}
        hmsg = payload.get("health_message")
        single_data: dict[str, Any] = {
            "mode": "single",
            "source_id": str(sid),
            "display_name": display_name,
            "latitude": lat,
            "longitude": lon,
            "kpis": kpis,
            "health_status": hf.get("health_status"),
            "health_message": str(hmsg) if hmsg else None,
            "blink_mode": blink,
            "updated_at": updated_at.isoformat() if updated_at else None,
        }
        if lat is None or lon is None:
            single_data["degraded"] = True
            single_data["warning"] = (
                "Source has no coordinates for the configured latitude/longitude fields."
            )
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": single_data,
        }

    if not st or not sid_raw:
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": {"error": "missing source binding"},
        }
    try:
        sid = uuid.UUID(str(sid_raw))
    except ValueError:
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": {"error": "invalid source_id"},
        }

    payload, updated_at, display_name = _load_source_record(
        db, customer_id=customer_id, source_type=str(st), source_id=sid
    )
    if payload is None:
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": {
                "degraded": True,
                "warning": "Bound source no longer exists or is not accessible.",
                "source_missing": True,
            },
        }

    merged = {**payload, **payload.get("_kpi", {})}
    hf = extract_health_fields(payload)
    blink = derive_blink_mode(
        health_status=hf.get("health_status") if isinstance(hf.get("health_status"), str) else None,
        health_blink=hf.get("health_blink") if isinstance(hf.get("health_blink"), bool) else None,
        health_severity=hf.get("health_severity") if isinstance(hf.get("health_severity"), int) else None,
        offline=hf.get("offline") if isinstance(hf.get("offline"), bool) else None,
    )
    health_status = hf.get("health_status")

    base = {
        "source_id": str(sid),
        "display_name": display_name,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "health_status": health_status,
        "blink_mode": blink,
    }

    lifecycle_warning: str | None = None
    if str(st) == "data_object":
        dorw = db.get(DataObject, sid)
        if dorw and (dorw.lifecycle_status or "").lower() not in ("published", "compiled"):
            lifecycle_warning = (
                f"Source data_object lifecycle is {dorw.lifecycle_status!r} (not published/compiled)."
            )

    def apply_lifecycle(d: dict[str, Any]) -> dict[str, Any]:
        if not lifecycle_warning:
            return d
        out = {**d}
        out["degraded"] = True
        w = out.get("warning")
        out["warning"] = f"{w} {lifecycle_warning}".strip() if isinstance(w, str) and w else lifecycle_warning
        return out

    if wtype == "kpi":
        metric = _bget(binding, "metric", "metric") or "value"
        v = _get_path(merged, str(metric))
        if v is None:
            v = merged.get(metric)
        kpi_data: dict[str, Any] = {**base, "value": v, "metric": metric}
        if v is None:
            kpi_data["degraded"] = True
            kpi_data["warning"] = f"Metric {metric!r} could not be resolved from the current source payload."
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": apply_lifecycle(kpi_data),
        }

    if wtype == "table":
        fields = binding.get("fields") or binding.get("columns")
        if isinstance(fields, str):
            fields = [fields]
        rows = _table_rows(merged)
        row_indicators: list[dict[str, Any]] = []
        for r in rows:
            rd = r if isinstance(r, dict) else {}
            rhf = extract_health_fields(rd)
            hmsg = rd.get("health_message")
            row_indicators.append(
                {
                    "health_status": rhf.get("health_status"),
                    "health_message": str(hmsg) if hmsg else None,
                    "blink_mode": derive_blink_mode(
                        health_status=rhf.get("health_status") if isinstance(rhf.get("health_status"), str) else None,
                        health_blink=rhf.get("health_blink") if isinstance(rhf.get("health_blink"), bool) else None,
                        health_severity=rhf.get("health_severity") if isinstance(rhf.get("health_severity"), int) else None,
                        offline=rhf.get("offline") if isinstance(rhf.get("offline"), bool) else None,
                    ),
                }
            )
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": apply_lifecycle(
                {
                    **base,
                    "rows": rows,
                    "fields": fields,
                    "row_indicators": row_indicators,
                }
            ),
        }

    if wtype == "chart":
        xf = str(_bget(binding, "x_field", "xField") or "t")
        yf = str(_bget(binding, "y_field", "yField") or "value")
        ct = str(_bget(binding, "chart_type", "chartType") or "line")
        ser = _chart_series(merged, xf, yf)
        ys = ser.get("y") if isinstance(ser.get("y"), list) else []
        xs = ser.get("x") if isinstance(ser.get("x"), list) else []
        chart_data: dict[str, Any] = {
            **base,
            "chart_type": ct,
            "x_field": xf,
            "y_field": yf,
            "series": ser,
        }
        if not xs and not ys:
            chart_data["degraded"] = True
            chart_data["warning"] = "No chart series could be built from the source with the configured x/y fields."
        elif ys and all(x is None for x in ys):
            chart_data["degraded"] = True
            chart_data["warning"] = "All Y values are empty for the configured y field."
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": apply_lifecycle(chart_data),
        }

    if wtype == "device_tile":
        kpi_fields = binding.get("kpi_fields") or binding.get("kpiFields") or []
        if isinstance(kpi_fields, str):
            kpi_fields = [kpi_fields]
        kpis: dict[str, Any] = {}
        for k in kpi_fields:
            kpis[str(k)] = _get_path(merged, str(k))
        device = None
        if st == "data_object":
            drow = db.get(DataObject, sid)
            if drow:
                device = db.get(Device, drow.device_id)
        tile: dict[str, Any] = {
            **base,
            "kpis": kpis,
            "device_name": device.name if device else display_name,
            "device_icon": device.icon if device else None,
            "health_message": str(merged.get("health_message")) if merged.get("health_message") else None,
        }
        if st == "data_object" and not device:
            tile["degraded"] = True
            tile["warning"] = "Device record missing for this data_object."
        return {
            "widget_id": wid,
            "type": wtype,
            "title": title,
            "data": apply_lifecycle(tile),
        }

    return {
        "widget_id": wid,
        "type": wtype,
        "title": title,
        "data": apply_lifecycle({**base, "raw": payload}),
    }


def build_live_payload(
    db: Session,
    *,
    customer_id: uuid.UUID,
    layout: dict[str, Any],
    dashboard_meta: dict[str, Any],
    dashboard_site_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    widgets_out: list[dict[str, Any]] = []
    for w in iter_widgets(layout):
        widgets_out.append(
            resolve_widget_data(
                db,
                customer_id=customer_id,
                widget=w,
                dashboard_site_id=dashboard_site_id,
            )
        )
    merged_meta = {**dashboard_meta, "settings": merge_layout_settings(layout)}
    return {
        "dashboard": merged_meta,
        "widgets": widgets_out,
        "rendered_at": datetime.now(timezone.utc).isoformat(),
    }
