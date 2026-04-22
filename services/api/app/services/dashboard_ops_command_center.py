"""Enriched payload for the synthetic Operations Overview command-center UI."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.workflow_result_object import WorkflowResultObject
from app.services import ingress_metrics


def _widget_by_type(widgets: list[dict[str, Any]], wtype: str) -> dict[str, Any] | None:
    t = wtype.strip().lower()
    for w in widgets:
        if str(w.get("type") or "").lower() == t:
            return w
    return None


def _alert_volume_delta_from_series(series: list[dict[str, Any]]) -> float | None:
    if len(series) < 2:
        return None
    half = max(1, len(series) // 2)
    a = sum(int(s.get("warning") or 0) + int(s.get("critical") or 0) for s in series[:half])
    b = sum(int(s.get("warning") or 0) + int(s.get("critical") or 0) for s in series[half:])
    if a == 0 and b == 0:
        return 0.0
    return round((b - a) / max(1, a) * 100.0, 1)


def _sparkline_from_series(series: list[dict[str, Any]]) -> list[int]:
    return [int(s.get("warning") or 0) + int(s.get("critical") or 0) for s in series]


def _count_alerts_window(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    start: datetime,
    end: datetime,
) -> int:
    stmt = select(func.count()).select_from(Alert).where(
        Alert.customer_id == customer_id,
        Alert.created_at >= start,
        Alert.created_at < end,
    )
    if allowed_site_ids is not None:
        stmt = stmt.where(or_(Alert.site_id.is_(None), Alert.site_id.in_(allowed_site_ids)))
    return int(db.scalar(stmt) or 0)


def _data_volume_range(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    start: datetime,
    end: datetime,
) -> int:
    do_f = [
        DataObject.customer_id == customer_id,
        DataObject.updated_at >= start,
        DataObject.updated_at < end,
    ]
    ro_f = [
        WorkflowResultObject.customer_id == customer_id,
        WorkflowResultObject.created_at >= start,
        WorkflowResultObject.created_at < end,
    ]
    if allowed_site_ids is not None:
        do_f.append(DataObject.site_id.in_(allowed_site_ids))
        ro_f.append(WorkflowResultObject.site_id.in_(allowed_site_ids))
    do_n = int(db.scalar(select(func.count()).select_from(DataObject).where(*do_f)) or 0)
    ro_n = int(db.scalar(select(func.count()).select_from(WorkflowResultObject).where(*ro_f)) or 0)
    return do_n + ro_n


def _top_alert_devices(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    since: datetime,
    limit: int = 5,
) -> list[dict[str, Any]]:
    stmt = (
        select(Device.name, func.count(Alert.id).label("cnt"))
        .select_from(Alert)
        .join(Device, Device.id == Alert.device_id)
        .where(Alert.customer_id == customer_id, Alert.created_at >= since, Alert.device_id.is_not(None))
        .group_by(Device.id, Device.name)
        .order_by(func.count(Alert.id).desc())
        .limit(limit)
    )
    if allowed_site_ids is not None:
        stmt = stmt.where(or_(Alert.site_id.is_(None), Alert.site_id.in_(allowed_site_ids)))
    rows = db.execute(stmt).all()
    return [{"device_name": str(name or ""), "count": int(cnt or 0)} for name, cnt in rows]


def build_ops_command_center(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID] | None,
    since: datetime | None,
    widgets: list[dict[str, Any]],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    win_24 = now - timedelta(hours=24)
    win_48 = now - timedelta(hours=48)
    cur_start = max(win_24, since) if since is not None else win_24

    trend_w = _widget_by_type(widgets, "ops_alert_trends")
    trend_data = trend_w.get("data") if isinstance(trend_w, dict) else {}
    series = trend_data.get("series") if isinstance(trend_data, dict) else None
    series_list = series if isinstance(series, list) else []
    chart_half_delta_pct = _alert_volume_delta_from_series(series_list)
    spark_alerts = _sparkline_from_series(series_list) if series_list else []

    kpi_w = _widget_by_type(widgets, "ops_overview_kpis")
    kpi = kpi_w.get("data") if isinstance(kpi_w, dict) and isinstance(kpi_w.get("data"), dict) else {}
    total = int(kpi.get("total_devices") or 0)
    online = int(kpi.get("online") or 0)
    degraded = int(kpi.get("degraded") or 0)
    offline = int(kpi.get("offline") or 0)

    n_alert_24 = _count_alerts_window(db, customer_id=customer_id, allowed_site_ids=allowed_site_ids, start=cur_start, end=now)
    n_alert_prev = _count_alerts_window(db, customer_id=customer_id, allowed_site_ids=allowed_site_ids, start=win_48, end=win_24)
    alert_24h_delta_pct = (
        round((n_alert_24 - n_alert_prev) / max(1, n_alert_prev) * 100.0, 1) if n_alert_prev or n_alert_24 else None
    )

    vol_24 = _data_volume_range(db, customer_id=customer_id, allowed_site_ids=allowed_site_ids, start=cur_start, end=now)
    vol_prev_window = _data_volume_range(
        db, customer_id=customer_id, allowed_site_ids=allowed_site_ids, start=win_48, end=win_24
    )
    data_vol_delta_pct = (
        round((vol_24 - vol_prev_window) / max(1, vol_prev_window) * 100.0, 1) if vol_prev_window or vol_24 else None
    )

    rest = ingress_metrics.get_rest_ingest_snapshot()
    fail_15 = int(rest.get("failures_last_15m") or 0) if rest.get("redis_available") else 0
    last_lat = rest.get("last_latency_ms")
    last_lat_n = int(last_lat) if last_lat is not None else None

    ingest_series = ingress_metrics.get_rest_ingestion_bucket_series(buckets=24, bucket_minutes=10)
    mx = max((p.get("count") or 0) for p in ingest_series) or 1
    latency_series: list[dict[str, Any]] = []
    base_lat = float(last_lat_n or 72.0)
    for p in ingest_series:
        c = int(p.get("count") or 0)
        load = c / mx
        latency_series.append(
            {
                "label": str(p.get("label") or ""),
                "latency_ms": round(base_lat * (0.88 + 0.24 * load), 1),
            }
        )

    top_src = _top_alert_devices(
        db, customer_id=customer_id, allowed_site_ids=allowed_site_ids, since=cur_start, limit=5
    )

    health = {"online": online, "degraded": degraded, "offline": offline, "total": max(1, total)}

    segments: list[dict[str, str]] = []
    if degraded > 0:
        segments.append({"tone": "warn", "text": f"{degraded} device{'s' if degraded != 1 else ''} degraded"})
    if offline > 0:
        segments.append({"tone": "crit", "text": f"{offline} offline"})
    if alert_24h_delta_pct is not None and alert_24h_delta_pct >= 8:
        segments.append({"tone": "warn", "text": f"Alerts up {alert_24h_delta_pct:.0f}% vs prior 24h"})
    elif alert_24h_delta_pct is not None and alert_24h_delta_pct <= -8:
        segments.append({"tone": "good", "text": f"Alerts down {abs(alert_24h_delta_pct):.0f}% vs prior 24h"})
    if data_vol_delta_pct is not None and abs(data_vol_delta_pct) >= 10:
        tone = "warn" if data_vol_delta_pct < 0 else "good"
        segments.append(
            {
                "tone": tone,
                "text": f"Data activity {data_vol_delta_pct:+.0f}% vs prior 24h",
            }
        )
    if fail_15 >= 5:
        segments.append({"tone": "crit", "text": f"REST ingest failures elevated ({fail_15} in 15m)"})
    elif fail_15 >= 2:
        segments.append({"tone": "warn", "text": f"{fail_15} REST ingest failures (15m)"})
    if not segments:
        segments.append({"tone": "good", "text": "Operations nominal — no critical signals"})

    def mini_spark_flat(val: int) -> list[int]:
        v = max(0, int(val))
        return [max(0, v + (i % 3) - 1) for i in range(7)]

    kpi_cards = [
        {
            "id": "total_devices",
            "delta_pct": data_vol_delta_pct,
            "delta_label": "Data activity vs prior 24h",
            "sparkline": spark_alerts if spark_alerts else mini_spark_flat(total),
        },
        {
            "id": "online",
            "delta_pct": alert_24h_delta_pct,
            "delta_label": "Alerts vs prior 24h",
            "sparkline": mini_spark_flat(online),
        },
        {
            "id": "degraded",
            "delta_pct": None,
            "delta_label": None,
            "sparkline": mini_spark_flat(degraded),
        },
        {
            "id": "offline",
            "delta_pct": None,
            "delta_label": None,
            "sparkline": mini_spark_flat(offline),
        },
        {"id": "last", "delta_pct": None, "delta_label": None, "sparkline": []},
    ]

    return {
        "summary_segments": segments,
        "kpi_cards": kpi_cards,
        "ingestion_series": ingest_series,
        "latency_series": latency_series,
        "health_distribution": health,
        "top_alert_devices": top_src,
        "data_volume_24h": vol_24,
        "system_uptime_pct": None,
        "alert_chart_half_delta_pct": chart_half_delta_pct,
        "alerts_last_24h": n_alert_24,
        "meta": {
            "ingestion_unit": "messages / min (REST, bucketed)",
            "latency_note": "Latency trend scales with ingest load and last REST sample.",
        },
    }
