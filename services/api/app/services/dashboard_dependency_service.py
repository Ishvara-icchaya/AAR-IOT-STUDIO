"""Frozen dashboard dependency checks for hard-delete protection."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dashboard_status import DASHBOARD_FROZEN
from app.models.dashboard import Dashboard
from app.models.data_object import DataObject
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.dashboard_layout import iter_widgets
from app.services.dashboard_validation import SITE_AGGREGATE_WIDGETS, _bget, _cget

SourceKind = Literal["data_object", "result_object", "site", "device", "workflow"]


def _parse_uuid(raw: Any) -> uuid.UUID | None:
    if raw is None:
        return None
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        return None


def _collect_from_widget(
    db: Session,
    *,
    w: dict[str, Any],
    data_ids: set[uuid.UUID],
    result_ids: set[uuid.UUID],
    device_ids: set[uuid.UUID],
) -> None:
    t = w.get("type")
    b = w.get("binding") or {}
    cfg = w.get("config") or {}

    if t == "text":
        return

    if t == "map":
        auto = bool(_cget(cfg, "auto_include_gps_objects", "autoIncludeGpsObjects", True))
        if auto:
            return
        st = _bget(b, "source_type", "sourceType")
        sid = _parse_uuid(_bget(b, "source_id", "sourceId"))
        if sid and st == "data_object":
            data_ids.add(sid)
            row = db.get(DataObject, sid)
            if row:
                device_ids.add(row.device_id)
        elif sid and st == "result_object":
            result_ids.add(sid)
        return

    if t in SITE_AGGREGATE_WIDGETS:
        return

    st = _bget(b, "source_type", "sourceType")
    sid = _parse_uuid(_bget(b, "source_id", "sourceId"))
    if not sid or st not in ("data_object", "result_object"):
        return

    if st == "data_object":
        data_ids.add(sid)
        row = db.get(DataObject, sid)
        if row:
            device_ids.add(row.device_id)
    elif st == "result_object":
        result_ids.add(sid)


def _layout_refs(db: Session, *, layout: dict[str, Any]) -> tuple[set[uuid.UUID], set[uuid.UUID], set[uuid.UUID]]:
    data_ids: set[uuid.UUID] = set()
    result_ids: set[uuid.UUID] = set()
    device_ids: set[uuid.UUID] = set()
    for w in iter_widgets(layout):
        _collect_from_widget(
            db,
            w=w,
            data_ids=data_ids,
            result_ids=result_ids,
            device_ids=device_ids,
        )
    return data_ids, result_ids, device_ids


def _frozen_dashboards(db: Session, *, customer_id: uuid.UUID) -> list[Dashboard]:
    return list(
        db.scalars(
            select(Dashboard).where(
                Dashboard.customer_id == customer_id,
                Dashboard.status == DASHBOARD_FROZEN,
            )
        ).all()
    )


def dashboards_referencing_data_object(
    db: Session, *, customer_id: uuid.UUID, data_object_id: uuid.UUID
) -> list[Dashboard]:
    hits: list[Dashboard] = []
    for d in _frozen_dashboards(db, customer_id=customer_id):
        data_ids, _, _ = _layout_refs(db, layout=dict(d.layout or {}))
        if data_object_id in data_ids:
            hits.append(d)
    return hits


def dashboards_referencing_result_object(
    db: Session, *, customer_id: uuid.UUID, result_object_id: uuid.UUID
) -> list[Dashboard]:
    hits: list[Dashboard] = []
    for d in _frozen_dashboards(db, customer_id=customer_id):
        _, result_ids, _ = _layout_refs(db, layout=dict(d.layout or {}))
        if result_object_id in result_ids:
            hits.append(d)
    return hits


def dashboards_referencing_site(
    db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID
) -> list[Dashboard]:
    hits: list[Dashboard] = []
    for d in _frozen_dashboards(db, customer_id=customer_id):
        if d.site_id == site_id:
            hits.append(d)
    return hits


def dashboards_referencing_device(
    db: Session, *, customer_id: uuid.UUID, device_id: uuid.UUID
) -> list[Dashboard]:
    hits: list[Dashboard] = []
    for d in _frozen_dashboards(db, customer_id=customer_id):
        data_ids, _, device_ids = _layout_refs(db, layout=dict(d.layout or {}))
        if device_id in device_ids:
            hits.append(d)
            continue
        for doid in data_ids:
            row = db.get(DataObject, doid)
            if row and row.device_id == device_id:
                hits.append(d)
                break
    return hits


def dashboards_referencing_workflow_outputs(
    db: Session, *, customer_id: uuid.UUID, workflow_id: uuid.UUID
) -> list[Dashboard]:
    ro_ids = set(
        db.scalars(
            select(WorkflowResultObject.id).where(
                WorkflowResultObject.workflow_id == workflow_id,
                WorkflowResultObject.customer_id == customer_id,
            )
        ).all()
    )
    if not ro_ids:
        return []
    hits: list[Dashboard] = []
    for d in _frozen_dashboards(db, customer_id=customer_id):
        _, result_ids, _ = _layout_refs(db, layout=dict(d.layout or {}))
        if result_ids & ro_ids:
            hits.append(d)
    return hits


def check_data_object_in_use(db: Session, *, customer_id: uuid.UUID, data_object_id: uuid.UUID) -> list[Dashboard]:
    return dashboards_referencing_data_object(db, customer_id=customer_id, data_object_id=data_object_id)


def check_result_object_in_use(db: Session, *, customer_id: uuid.UUID, result_object_id: uuid.UUID) -> list[Dashboard]:
    return dashboards_referencing_result_object(db, customer_id=customer_id, result_object_id=result_object_id)


def check_site_in_use(db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID) -> list[Dashboard]:
    return dashboards_referencing_site(db, customer_id=customer_id, site_id=site_id)


def check_device_in_use(db: Session, *, customer_id: uuid.UUID, device_id: uuid.UUID) -> list[Dashboard]:
    """Informational: device deletes are allowed; widgets degrade at runtime."""
    return dashboards_referencing_device(db, customer_id=customer_id, device_id=device_id)


def check_workflow_outputs_in_use(db: Session, *, customer_id: uuid.UUID, workflow_id: uuid.UUID) -> list[Dashboard]:
    return dashboards_referencing_workflow_outputs(db, customer_id=customer_id, workflow_id=workflow_id)


def list_dashboards_using_source(
    db: Session,
    *,
    customer_id: uuid.UUID,
    source_kind: SourceKind,
    source_id: uuid.UUID,
) -> list[Dashboard]:
    if source_kind == "data_object":
        return check_data_object_in_use(db, customer_id=customer_id, data_object_id=source_id)
    if source_kind == "result_object":
        return check_result_object_in_use(db, customer_id=customer_id, result_object_id=source_id)
    if source_kind == "site":
        return check_site_in_use(db, customer_id=customer_id, site_id=source_id)
    if source_kind == "device":
        return check_device_in_use(db, customer_id=customer_id, device_id=source_id)
    if source_kind == "workflow":
        return check_workflow_outputs_in_use(db, customer_id=customer_id, workflow_id=source_id)
    return []


def resource_in_use_detail(*, resource_label: str, dashboards: list[Dashboard]) -> dict[str, Any]:
    n = len(dashboards)
    noun = "dashboard" if n == 1 else "dashboards"
    return {
        "error": "resource_in_use",
        "message": f"This {resource_label} is used by {n} frozen {noun}",
        "dashboards": [{"id": str(d.id), "name": d.name} for d in dashboards],
    }
