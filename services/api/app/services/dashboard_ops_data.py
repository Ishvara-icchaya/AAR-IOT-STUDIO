"""Aggregated data for synthetic / template ops dashboard widgets (metadata + rollups only)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.site import Site
from app.models.workflow_result_object import WorkflowResultObject


def build_ops_overview_kpis_data(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
) -> dict[str, Any]:
    """Device counts by liveness + last seen hint."""
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        return {
            "total_devices": 0,
            "online": 0,
            "degraded": 0,
            "offline": 0,
            "last_data_relative": "—",
            "last_device_name": None,
        }
    stmt = (
        select(Device.current_liveness_state, func.count())
        .where(Device.customer_id == customer_id)
        .group_by(Device.current_liveness_state)
    )
    if allowed_site_ids is not None:
        stmt = stmt.where(Device.site_id.in_(allowed_site_ids))
    rows = db.execute(stmt).all()
    by_state: dict[str, int] = {}
    for st, cnt in rows:
        key = str(st or "waiting_for_first_payload")
        by_state[key] = int(cnt or 0)

    total = sum(by_state.values())
    online = int(by_state.get("online", 0))
    late = int(by_state.get("late", 0))
    offline = int(by_state.get("offline", 0))
    waiting = int(by_state.get("waiting_for_first_payload", 0))
    degraded = late + waiting

    last_q = (
        select(Device.last_seen_at, Device.name)
        .where(Device.customer_id == customer_id)
        .where(Device.last_seen_at.is_not(None))
        .order_by(Device.last_seen_at.desc())
        .limit(1)
    )
    if allowed_site_ids is not None:
        last_q = last_q.where(Device.site_id.in_(allowed_site_ids))
    lr = db.execute(last_q).first()
    last_seen: datetime | None = None
    last_name: str | None = None
    if lr:
        last_seen, last_name = lr[0], lr[1]

    rel = "—"
    if last_seen:
        delta = datetime.now(timezone.utc) - last_seen
        if delta.total_seconds() < 60:
            rel = "just now"
        elif delta.total_seconds() < 3600:
            rel = f"{int(delta.total_seconds() // 60)}m ago"
        elif delta.total_seconds() < 86400:
            rel = f"{int(delta.total_seconds() // 3600)}h ago"
        else:
            rel = f"{int(delta.days)}d ago"

    return {
        "total_devices": total,
        "online": online,
        "degraded": degraded,
        "offline": offline,
        "last_data_relative": rel,
        "last_device_name": last_name,
    }


def build_ops_device_table_data(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    limit: int = 20,
) -> dict[str, Any]:
    """Top devices ordered offline → late → waiting → online."""
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        return {
            "rows": [],
            "fields": ["device_name", "site_name", "status", "last_seen"],
            "column_headers": {
                "device_name": "Device",
                "site_name": "Site",
                "status": "Status",
                "last_seen": "Last seen",
            },
            "row_indicators": [],
        }
    order = case(
        (Device.current_liveness_state == "offline", 0),
        (Device.current_liveness_state == "late", 1),
        (Device.current_liveness_state == "waiting_for_first_payload", 2),
        (Device.current_liveness_state == "online", 3),
        else_=4,
    )
    stmt = (
        select(Device, Site.name)
        .join(Site, Site.id == Device.site_id)
        .where(Device.customer_id == customer_id)
        .order_by(
            order.asc(),
            Device.last_seen_at.desc().nulls_last(),
            Device.name.asc(),
        )
        .limit(max(5, min(limit, 50)))
    )
    if allowed_site_ids is not None:
        stmt = stmt.where(Device.site_id.in_(allowed_site_ids))
    rows = db.execute(stmt).all()
    out_rows: list[dict[str, Any]] = []
    for dev, site_name in rows:
        health = dev.current_liveness_state
        out_rows.append(
            {
                "device_name": dev.name,
                "site_name": site_name,
                "status": health,
                "last_seen": dev.last_seen_at.isoformat() if dev.last_seen_at else None,
                "_health": health,
            }
        )
    fields = ["device_name", "site_name", "status", "last_seen"]
    row_indicators = [
        {"health_status": r.get("_health"), "health_message": None, "blink_mode": "none"} for r in out_rows
    ]
    for r in out_rows:
        r.pop("_health", None)
    return {
        "rows": out_rows,
        "fields": fields,
        "column_headers": {
            "device_name": "Device",
            "site_name": "Site",
            "status": "Status",
            "last_seen": "Last seen",
        },
        "row_indicators": row_indicators,
    }


def build_ops_recent_alerts_data(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    limit: int = 5,
    since: datetime | None = None,
) -> dict[str, Any]:
    """Latest alerts (severity, device/site names, timestamp) — no bindings."""
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        return {"items": []}
    lim = max(1, min(int(limit or 48), 120))
    stmt = (
        select(Alert, Site.name, Device.name)
        .outerjoin(Site, Site.id == Alert.site_id)
        .outerjoin(Device, Device.id == Alert.device_id)
        .where(Alert.customer_id == customer_id)
        .order_by(Alert.created_at.desc())
        .limit(lim)
    )
    if since is not None:
        stmt = stmt.where(Alert.created_at >= since)
    if allowed_site_ids is not None:
        stmt = stmt.where(or_(Alert.site_id.is_(None), Alert.site_id.in_(allowed_site_ids)))
    rows = db.execute(stmt).all()
    items: list[dict[str, Any]] = []
    for a, site_name, device_name in rows:
        items.append(
            {
                "severity": str(a.severity or ""),
                "title": str(a.title or ""),
                "device_name": str(device_name) if device_name else None,
                "site_name": str(site_name) if site_name else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
        )
    return {"items": items}


def build_ops_alert_trends_data(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    since: datetime | None = None,
    num_days: int = 7,
) -> dict[str, Any]:
    """Daily counts of warning vs critical alerts (bar chart payload)."""
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        return {"series": []}
    nd = max(1, min(int(num_days or 7), 14))
    end = datetime.now(timezone.utc)
    end_day = end.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    window_start = end_day - timedelta(days=nd - 1)
    start = window_start
    if since is not None and since > start:
        start = since.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    sev_l = func.lower(Alert.severity)
    stmt = (
        select(
            func.date_trunc("day", Alert.created_at).label("day"),
            sev_l.label("sev"),
            func.count(Alert.id),
        )
        .where(
            Alert.customer_id == customer_id,
            Alert.created_at >= start,
            Alert.created_at <= end,
            sev_l.in_(("warning", "critical")),
        )
    )
    if allowed_site_ids is not None:
        stmt = stmt.where(or_(Alert.site_id.is_(None), Alert.site_id.in_(allowed_site_ids)))
    stmt = stmt.group_by(func.date_trunc("day", Alert.created_at), sev_l).order_by(func.date_trunc("day", Alert.created_at))
    raw = db.execute(stmt).all()
    by_day: dict[datetime, dict[str, int]] = {}
    for day, sev, cnt in raw:
        if day is None:
            continue
        d0 = day.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        bucket = by_day.setdefault(d0, {"warning": 0, "critical": 0})
        s = str(sev or "").lower()
        if s == "warning":
            bucket["warning"] += int(cnt or 0)
        elif s == "critical":
            bucket["critical"] += int(cnt or 0)

    series: list[dict[str, Any]] = []
    for i in range(nd):
        cur = window_start + timedelta(days=i)
        b = by_day.get(cur, {"warning": 0, "critical": 0})
        series.append(
            {
                "day": cur.date().isoformat(),
                "label": cur.strftime("%b %d"),
                "warning": int(b["warning"]),
                "critical": int(b["critical"]),
            }
        )
    return {"series": series}


def _activity_summary_line(name: str, event_type: str) -> str:
    if event_type == "Data object":
        return f"{name} updated"
    if event_type == "Workflow result":
        return f"Workflow completed — {name}"
    return f"{name} — {event_type}"


def build_ops_recent_activity_data(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    limit_each: int = 5,
    since: datetime | None = None,
) -> dict[str, Any]:
    """Recent data-object / workflow-result activity (human summary + type + timestamp)."""
    if allowed_site_ids is not None and len(allowed_site_ids) == 0:
        return {"items": []}
    le = max(5, min(int(limit_each or 48), 120))
    do_stmt = select(DataObject.name, DataObject.updated_at).where(DataObject.customer_id == customer_id)
    if allowed_site_ids is not None:
        do_stmt = do_stmt.where(DataObject.site_id.in_(allowed_site_ids))
    if since is not None:
        do_stmt = do_stmt.where(DataObject.updated_at >= since)
    do_stmt = do_stmt.order_by(DataObject.updated_at.desc()).limit(le)
    dos = list(db.execute(do_stmt).all())

    ro_stmt = select(WorkflowResultObject.result_object_name, WorkflowResultObject.created_at).where(
        WorkflowResultObject.customer_id == customer_id
    )
    if allowed_site_ids is not None:
        ro_stmt = ro_stmt.where(WorkflowResultObject.site_id.in_(allowed_site_ids))
    if since is not None:
        ro_stmt = ro_stmt.where(WorkflowResultObject.created_at >= since)
    ro_stmt = ro_stmt.order_by(WorkflowResultObject.created_at.desc()).limit(le)
    ros = list(db.execute(ro_stmt).all())

    events: list[tuple[datetime, str, str]] = []
    for name, ts in dos:
        if ts and name:
            events.append((ts, str(name), "Data object"))
    for name, ts in ros:
        if ts and name:
            events.append((ts, str(name), "Workflow result"))
    events.sort(key=lambda x: x[0], reverse=True)
    items: list[dict[str, Any]] = []
    for ts, name, et in events[:le]:
        ts_aware = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        items.append(
            {
                "object_name": name,
                "event_type": et,
                "summary": _activity_summary_line(name, et),
                "timestamp": ts_aware.astimezone(timezone.utc).isoformat(),
            }
        )
    return {"items": items}
