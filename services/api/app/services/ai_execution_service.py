"""Bounded, parameterized reads only — maps approved plans to ORM queries."""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.alert import Alert
from app.models.dashboard import Dashboard
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.published_service import PublishedService
from app.models.site import Site
from app.models.workflow import Workflow
from app.models.workflow_execution import WorkflowExecution
from app.models.workflow_result_object import WorkflowResultObject
from app.services.ai_health_timescale_service import query_health_trends
from app.services.ai_kpi_timescale_service import query_kpi_trends, sanitize_kpi_keys
from app.services.ai_publish_delivery_service import query_publish_delivery_trends
from app.services.monitoring_service import build_overview, collect_platform_state


def window_from_preset(preset: str | None) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    p = (preset or "last_24_hours").lower().replace(" ", "_")
    if p in ("last_7_days", "last_7d", "week"):
        start = now - timedelta(days=7)
    elif p in ("last_30_days", "last_30d", "month"):
        start = now - timedelta(days=30)
    else:
        start = now - timedelta(hours=24)
    return start, now


def execute_plan(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID],
    plan: dict[str, Any],
    query_timeout_seconds: float | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    eff = float(
        query_timeout_seconds if query_timeout_seconds is not None else settings.ai_query_timeout_seconds
    )
    timeout_ms = max(100, min(int(eff * 1000), 600_000))
    with db.begin_nested():
        db.execute(text("SET LOCAL statement_timeout = :st"), {"st": f"{timeout_ms}ms"})
        return _execute_plan_core(
            db,
            customer_id=customer_id,
            allowed_site_ids=allowed_site_ids,
            plan=plan,
            statement_timeout_ms=timeout_ms,
        )


def _execute_plan_core(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed_site_ids: list[uuid.UUID],
    plan: dict[str, Any],
    statement_timeout_ms: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    dataset = plan["dataset"]
    limit = int(plan["limit"])
    agg = plan.get("aggregation") or "none"
    filters = plan.get("filters") or {}
    include_payload = bool(plan.get("include_payload"))
    tr = (plan.get("time_range") or {}).get("preset") or "last_24_hours"
    t0, t1 = window_from_preset(str(tr))

    site_ids = [uuid.UUID(str(x)) for x in filters.get("site_ids") or []]
    site_ids = [s for s in site_ids if s in allowed_site_ids]
    if not site_ids and allowed_site_ids:
        site_ids = list(allowed_site_ids)

    if dataset != "ai_monitoring_overview" and not allowed_site_ids:
        return [], {"rows_returned": 0, "reason": "no_authorized_sites"}

    rows: list[dict[str, Any]] = []
    metrics: dict[str, Any] = {}

    if dataset == "ai_kpi_trends":
        keys = sanitize_kpi_keys(filters.get("kpi_keys"))
        return query_kpi_trends(
            db,
            customer_id=customer_id,
            site_ids=site_ids,
            t0=t0,
            t1=t1,
            aggregation=agg,
            row_limit=limit,
            kpi_keys=keys,
            statement_timeout_ms=statement_timeout_ms,
        )

    if dataset == "ai_health_trends":
        return query_health_trends(
            db,
            customer_id=customer_id,
            site_ids=site_ids,
            t0=t0,
            t1=t1,
            aggregation=agg,
            row_limit=limit,
            statement_timeout_ms=statement_timeout_ms,
        )

    if dataset == "ai_publish_delivery_trends":
        ps_raw = filters.get("published_service_id")
        ps_uuid: uuid.UUID | None = None
        if ps_raw:
            try:
                ps_uuid = uuid.UUID(str(ps_raw))
            except (ValueError, TypeError):
                ps_uuid = None
        return query_publish_delivery_trends(
            db,
            customer_id=customer_id,
            site_ids=site_ids,
            t0=t0,
            t1=t1,
            aggregation=agg,
            row_limit=limit,
            published_service_id=ps_uuid,
        )

    if dataset == "ai_monitoring_overview":
        state = collect_platform_state(db)
        overview = build_overview(db, customer_id, state)
        rows = [{"summary": overview["summary"], "incident_sample": overview["recent_incidents"][:5]}]
        metrics["rows_returned"] = 1
        return rows, _aggregate_monitoring(rows, agg)

    if dataset == "ai_alerts_recent":
        q: Select[Any] = select(Alert).where(Alert.customer_id == customer_id, Alert.created_at >= t0)
        if site_ids:
            q = q.where((Alert.site_id.in_(site_ids)) | (Alert.site_id.is_(None)))
        sev = filters.get("severity")
        if isinstance(sev, list) and sev:
            q = q.where(Alert.severity.in_([str(s).lower() for s in sev]))
        if filters.get("acknowledged") is False:
            q = q.where(Alert.acknowledged.is_(False))
        cat = filters.get("category")
        if isinstance(cat, str) and cat:
            q = q.where(Alert.category == cat)
        q = q.order_by(Alert.created_at.desc()).limit(limit)
        for a in db.scalars(q).all():
            rows.append(
                {
                    "id": str(a.id),
                    "severity": a.severity,
                    "category": a.category,
                    "title": a.title,
                    "message": (a.message or "")[:500],
                    "acknowledged": a.acknowledged,
                    "site_id": str(a.site_id) if a.site_id else None,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                    "source_component": a.source_component,
                }
            )
        metrics["rows_returned"] = len(rows)
        return rows, _aggregate_alerts(rows, agg)

    if dataset == "ai_data_objects_latest":
        q = select(DataObject).where(DataObject.customer_id == customer_id)
        if site_ids:
            q = q.where(DataObject.site_id.in_(site_ids))
        ls = filters.get("lifecycle_status")
        if isinstance(ls, str) and ls:
            q = q.where(DataObject.lifecycle_status == ls)
        hs = filters.get("health_status")
        if isinstance(hs, str) and hs:
            q = q.where(DataObject.health_status == hs)
        q = q.order_by(DataObject.updated_at.desc()).limit(limit)  # type: ignore[attr-defined]
        is_catalog = str(plan.get("intent") or "") == "data_object_catalog"
        for d in db.scalars(q).all():
            item: dict[str, Any] = {
                "id": str(d.id),
                "name": d.name,
                "site_id": str(d.site_id),
                "device_id": str(d.device_id),
                "lifecycle_status": d.lifecycle_status,
                "health_status": d.health_status,
                "updated_at": d.updated_at.isoformat() if d.updated_at else None,
            }
            if include_payload:
                item["payload_preview"] = str(d.payload)[:800]
                item["kpi_preview"] = str(d.kpi_json)[:800]
            else:
                item["kpi_keys"] = list((d.kpi_json or {}).keys())[:20]
            if is_catalog and getattr(d, "ai_projection", None) is not None:
                item["ai_projection"] = d.ai_projection
            rows.append(item)
        metrics["rows_returned"] = len(rows)
        return rows, _aggregate_data_objects(rows, agg)

    if dataset == "ai_sites":
        q = select(Site).where(Site.customer_id == customer_id)
        if site_ids:
            q = q.where(Site.id.in_(site_ids))
        q = q.order_by(Site.name.asc()).limit(limit)
        for s in db.scalars(q).all():
            rows.append(
                {
                    "id": str(s.id),
                    "name": s.name,
                    "description": (s.description or "")[:300],
                }
            )
        metrics["rows_returned"] = len(rows)
        return rows, metrics

    if dataset == "ai_devices":
        q = select(Device).where(Device.customer_id == customer_id)
        if site_ids:
            q = q.where(Device.site_id.in_(site_ids))
        if filters.get("is_active") is False:
            q = q.where(Device.is_active.is_(False))
        if filters.get("polling_enabled") is False:
            q = q.where(Device.polling_enabled.is_(False))
        q = q.order_by(Device.name.asc()).limit(limit)
        for d in db.scalars(q).all():
            desc = (d.description or "").strip()
            rows.append(
                {
                    "id": str(d.id),
                    "name": d.name,
                    "description": (desc[:400] + "…") if len(desc) > 400 else desc,
                    "site_id": str(d.site_id),
                    "is_active": d.is_active,
                    "polling_enabled": d.polling_enabled,
                }
            )
        metrics["rows_returned"] = len(rows)
        if agg == "count_by_site":
            c = Counter(r["site_id"] for r in rows)
            metrics["by_site"] = dict(c)
        return rows, metrics

    if dataset == "ai_kpi_snapshot":
        q = select(DataObject).where(DataObject.customer_id == customer_id)
        if site_ids:
            q = q.where(DataObject.site_id.in_(site_ids))
        q = q.where(text("data_objects.kpi_json IS NOT NULL AND data_objects.kpi_json <> '{}'::jsonb")).order_by(
            DataObject.updated_at.desc()
        ).limit(limit)
        for d in db.scalars(q).all():
            keys = list((d.kpi_json or {}).keys())
            rows.append(
                {
                    "id": str(d.id),
                    "name": d.name,
                    "site_id": str(d.site_id),
                    "kpi_keys": keys[:30],
                }
            )
        metrics["rows_returned"] = len(rows)
        if agg == "kpi_key_frequency":
            all_k: Counter[str] = Counter()
            for r in rows:
                for k in r.get("kpi_keys") or []:
                    all_k[str(k)] += 1
            metrics["top_kpi_keys"] = [{"name": k, "count": v} for k, v in all_k.most_common(15)]
        return rows, metrics

    if dataset == "ai_workflow_results_latest":
        q = select(WorkflowResultObject).where(WorkflowResultObject.customer_id == customer_id)
        if site_ids:
            q = q.where(WorkflowResultObject.site_id.in_(site_ids))
        hs = filters.get("health_status")
        if isinstance(hs, str) and hs:
            q = q.where(WorkflowResultObject.health_status == hs)
        q = q.order_by(WorkflowResultObject.created_at.desc()).limit(limit)
        for w in db.scalars(q).all():
            rows.append(
                {
                    "id": str(w.id),
                    "result_object_name": w.result_object_name,
                    "site_id": str(w.site_id),
                    "health_status": w.health_status,
                    "created_at": w.created_at.isoformat() if w.created_at else None,
                }
            )
        metrics["rows_returned"] = len(rows)
        if agg == "count_by_health":
            c = Counter((r.get("health_status") or "unknown") for r in rows)
            metrics["by_health"] = dict(c)
        return rows, metrics

    if dataset == "ai_workflow_executions_recent":
        q = (
            select(WorkflowExecution)
            .join(Workflow, WorkflowExecution.workflow_id == Workflow.id)
            .where(Workflow.customer_id == customer_id, WorkflowExecution.started_at >= t0)
        )
        if site_ids:
            q = q.where((Workflow.site_id.in_(site_ids)) | (Workflow.site_id.is_(None)))
        st = filters.get("status")
        if isinstance(st, list) and st:
            q = q.where(WorkflowExecution.status.in_([str(s) for s in st]))
        elif isinstance(st, str) and st:
            q = q.where(WorkflowExecution.status == st)
        q = q.order_by(WorkflowExecution.started_at.desc()).limit(limit)
        for ex in db.scalars(q).all():
            rows.append(
                {
                    "id": str(ex.id),
                    "workflow_id": str(ex.workflow_id),
                    "status": ex.status,
                    "started_at": ex.started_at.isoformat() if ex.started_at else None,
                    "error_message": (ex.error_message or "")[:400],
                }
            )
        metrics["rows_returned"] = len(rows)
        if agg == "count_by_status":
            c = Counter(r.get("status") or "unknown" for r in rows)
            metrics["by_status"] = dict(c)
        return rows, metrics

    if dataset == "ai_dashboards":
        q = select(Dashboard).where(Dashboard.customer_id == customer_id)
        if site_ids:
            q = q.where((Dashboard.site_id.in_(site_ids)) | (Dashboard.site_id.is_(None)))
        st = filters.get("status")
        if isinstance(st, str) and st:
            q = q.where(Dashboard.status == st)
        q = q.order_by(Dashboard.updated_at.desc()).limit(limit)  # type: ignore[attr-defined]
        for d in db.scalars(q).all():
            rows.append(
                {
                    "id": str(d.id),
                    "name": d.name,
                    "status": d.status,
                    "site_id": str(d.site_id) if d.site_id else None,
                }
            )
        metrics["rows_returned"] = len(rows)
        if agg == "count_by_status":
            c = Counter(r.get("status") or "unknown" for r in rows)
            metrics["by_status"] = dict(c)
        return rows, metrics

    if dataset == "ai_published_services":
        q = select(PublishedService).where(PublishedService.customer_id == customer_id)
        if site_ids:
            q = q.where(PublishedService.site_id.in_(site_ids))
        st = filters.get("status")
        if isinstance(st, str) and st:
            q = q.where(PublishedService.status == st)
        q = q.order_by(PublishedService.updated_at.desc()).limit(limit)  # type: ignore[attr-defined]
        for p in db.scalars(q).all():
            rows.append(
                {
                    "id": str(p.id),
                    "name": p.name,
                    "status": p.status,
                    "protocol": p.publish_protocol,
                    "site_id": str(p.site_id),
                }
            )
        metrics["rows_returned"] = len(rows)
        if agg == "count_by_status":
            c = Counter(r.get("status") or "unknown" for r in rows)
            metrics["by_status"] = dict(c)
        return rows, metrics

    metrics["rows_returned"] = 0
    return [], metrics


def _aggregate_alerts(rows: list[dict[str, Any]], agg: str) -> dict[str, Any]:
    m: dict[str, Any] = {"rows_returned": len(rows)}
    if agg == "count_by_severity":
        c = Counter((r.get("severity") or "unknown").lower() for r in rows)
        m["by_severity"] = dict(c)
        m["critical_count"] = int(c.get("critical", 0))
    if agg == "count_by_category":
        c = Counter((r.get("category") or "unknown").lower() for r in rows)
        m["by_category"] = dict(c)
        m["categories"] = [{"name": k, "count": v} for k, v in c.most_common(10)]
    return m


def _aggregate_data_objects(rows: list[dict[str, Any]], agg: str) -> dict[str, Any]:
    m: dict[str, Any] = {"rows_returned": len(rows)}
    if agg == "count_by_health":
        c = Counter((r.get("health_status") or "unknown") for r in rows)
        m["by_health"] = dict(c)
    if agg == "count_by_lifecycle":
        c = Counter((r.get("lifecycle_status") or "unknown") for r in rows)
        m["by_lifecycle"] = dict(c)
    return m


def _aggregate_monitoring(rows: list[dict[str, Any]], agg: str) -> dict[str, Any]:
    if not rows:
        return {"rows_returned": 0}
    summary = rows[0].get("summary") or {}
    return {
        "rows_returned": 1,
        "monitoring_summary": summary,
        "open_alerts_hint": summary.get("active_alerts"),
    }
