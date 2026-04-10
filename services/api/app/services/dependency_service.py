"""Central business-level dependency resolution (referential integrity policy)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.dashboard import Dashboard
from app.models.dashboard_user_preference import DashboardUserPreference
from app.models.data_object import DataObject
from app.models.published_service_delivery_log import PublishedServiceDeliveryLog
from app.models.device import Device
from app.models.published_service import PublishedService
from app.models.site import Site
from app.models.static_ingestion import StaticIngestion
from app.models.user_site import UserSite
from app.models.workflow import Workflow
from app.models.workflow_execution import WorkflowExecution
from app.models.workflow_node import WorkflowNode
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.integrity import DependencyItem
from app.services.dashboard_dependency_service import (
    check_data_object_in_use,
    check_device_in_use,
    check_result_object_in_use,
    check_site_in_use,
    check_workflow_outputs_in_use,
)


def _hint_workflow(wid: uuid.UUID) -> str:
    return f"/workflow/{wid}/edit"


def _hint_dashboard(did: uuid.UUID) -> str:
    return f"/dashboard/{did}/edit"


def _hint_published(sid: uuid.UUID) -> str:
    return f"/published-services/{sid}"


def _hint_device(did: uuid.UUID) -> str:
    return f"/devices/manage?highlight={did}"


def _hint_site(sid: uuid.UUID) -> str:
    return f"/admin/sites?highlight={sid}"


def workflows_binding_data_object(
    db: Session, *, customer_id: uuid.UUID, data_object_id: uuid.UUID
) -> list[Workflow]:
    seen: dict[uuid.UUID, Workflow] = {}
    for n in db.scalars(select(WorkflowNode).where(WorkflowNode.node_type == "input")).all():
        cfg = n.config_json or {}
        if str(cfg.get("data_object_id") or "") != str(data_object_id):
            continue
        wf = db.get(Workflow, n.workflow_id)
        if wf and wf.customer_id == customer_id:
            seen[wf.id] = wf
    return list(seen.values())


def published_services_for_data_object(
    db: Session, *, customer_id: uuid.UUID, data_object_id: uuid.UUID
) -> list[PublishedService]:
    return list(
        db.scalars(
            select(PublishedService).where(
                PublishedService.customer_id == customer_id,
                PublishedService.source_type == "data_object",
                PublishedService.source_object_id == data_object_id,
            )
        ).all()
    )


def published_services_for_result_object(
    db: Session, *, customer_id: uuid.UUID, result_object_id: uuid.UUID
) -> list[PublishedService]:
    return list(
        db.scalars(
            select(PublishedService).where(
                PublishedService.customer_id == customer_id,
                PublishedService.source_type == "result_object",
                PublishedService.source_object_id == result_object_id,
            )
        ).all()
    )


def published_services_for_workflow_result_objects(
    db: Session, *, customer_id: uuid.UUID, workflow_id: uuid.UUID
) -> list[PublishedService]:
    ro_ids = db.scalars(
        select(WorkflowResultObject.id).where(
            WorkflowResultObject.workflow_id == workflow_id,
            WorkflowResultObject.customer_id == customer_id,
        )
    ).all()
    if not ro_ids:
        return []
    rid_set = list(ro_ids)
    return list(
        db.scalars(
            select(PublishedService).where(
                PublishedService.customer_id == customer_id,
                PublishedService.source_type == "result_object",
                PublishedService.source_object_id.in_(rid_set),
            )
        ).all()
    )


def workflow_execution_count(db: Session, *, workflow_id: uuid.UUID) -> int:
    n = db.scalar(
        select(func.count())
        .select_from(WorkflowExecution)
        .where(WorkflowExecution.workflow_id == workflow_id)
    )
    return int(n or 0)


def data_object_delete_dependencies(
    db: Session, *, customer_id: uuid.UUID, data_object_id: uuid.UUID
) -> list[DependencyItem]:
    out: list[DependencyItem] = []
    for wf in workflows_binding_data_object(db, customer_id=customer_id, data_object_id=data_object_id):
        out.append(
            DependencyItem(
                entity_type="workflow",
                entity_id=str(wf.id),
                label=wf.name,
                route_hint=_hint_workflow(wf.id),
            )
        )
    for d in check_data_object_in_use(db, customer_id=customer_id, data_object_id=data_object_id):
        out.append(
            DependencyItem(
                entity_type="dashboard",
                entity_id=str(d.id),
                label=d.name,
                route_hint=_hint_dashboard(d.id),
            )
        )
    for ps in published_services_for_data_object(db, customer_id=customer_id, data_object_id=data_object_id):
        out.append(
            DependencyItem(
                entity_type="published_service",
                entity_id=str(ps.id),
                label=ps.name,
                route_hint=_hint_published(ps.id),
            )
        )
    return out


def result_object_delete_dependencies(
    db: Session, *, customer_id: uuid.UUID, result_object_id: uuid.UUID
) -> list[DependencyItem]:
    out: list[DependencyItem] = []
    for d in check_result_object_in_use(db, customer_id=customer_id, result_object_id=result_object_id):
        out.append(
            DependencyItem(
                entity_type="dashboard",
                entity_id=str(d.id),
                label=d.name,
                route_hint=_hint_dashboard(d.id),
            )
        )
    for ps in published_services_for_result_object(
        db, customer_id=customer_id, result_object_id=result_object_id
    ):
        out.append(
            DependencyItem(
                entity_type="published_service",
                entity_id=str(ps.id),
                label=ps.name,
                route_hint=_hint_published(ps.id),
            )
        )
    return out


def workflow_delete_dependencies(
    db: Session, *, customer_id: uuid.UUID, workflow_id: uuid.UUID
) -> list[DependencyItem]:
    out: list[DependencyItem] = []
    n = workflow_execution_count(db, workflow_id=workflow_id)
    if n > 0:
        out.append(
            DependencyItem(
                entity_type="workflow_execution",
                entity_id=str(workflow_id),
                label=f"{n} execution(s) on record",
                route_hint=_hint_workflow(workflow_id),
            )
        )
    for d in check_workflow_outputs_in_use(db, customer_id=customer_id, workflow_id=workflow_id):
        out.append(
            DependencyItem(
                entity_type="dashboard",
                entity_id=str(d.id),
                label=d.name,
                route_hint=_hint_dashboard(d.id),
            )
        )
    for ps in published_services_for_workflow_result_objects(
        db, customer_id=customer_id, workflow_id=workflow_id
    ):
        out.append(
            DependencyItem(
                entity_type="published_service",
                entity_id=str(ps.id),
                label=ps.name,
                route_hint=_hint_published(ps.id),
            )
        )
    return out


def site_delete_dependencies(
    db: Session, *, customer_id: uuid.UUID, site_id: uuid.UUID
) -> list[DependencyItem]:
    out: list[DependencyItem] = []
    site = db.get(Site, site_id)
    if not site or site.customer_id != customer_id:
        return out

    dev_n = db.scalar(select(func.count()).select_from(Device).where(Device.site_id == site_id)) or 0
    if int(dev_n) > 0:
        out.append(
            DependencyItem(
                entity_type="summary",
                entity_id=str(site_id),
                label=f"{int(dev_n)} device(s) on this site",
                route_hint=_hint_site(site_id),
            )
        )
    wf_n = db.scalar(
        select(func.count()).select_from(Workflow).where(Workflow.site_id == site_id)
    ) or 0
    if int(wf_n) > 0:
        out.append(
            DependencyItem(
                entity_type="summary",
                entity_id=str(site_id),
                label=f"{int(wf_n)} workflow(s) bound to this site",
                route_hint=_hint_site(site_id),
            )
        )
    for d in check_site_in_use(db, customer_id=customer_id, site_id=site_id):
        out.append(
            DependencyItem(
                entity_type="dashboard",
                entity_id=str(d.id),
                label=d.name,
                route_hint=_hint_dashboard(d.id),
            )
        )
    ps_n = db.scalar(
        select(func.count())
        .select_from(PublishedService)
        .where(PublishedService.site_id == site_id)
    ) or 0
    if int(ps_n) > 0:
        out.append(
            DependencyItem(
                entity_type="summary",
                entity_id=str(site_id),
                label=f"{int(ps_n)} published service(s)",
                route_hint="/published-services",
            )
        )
    si_n = db.scalar(
        select(func.count())
        .select_from(StaticIngestion)
        .where(StaticIngestion.site_id == site_id)
    ) or 0
    if int(si_n) > 0:
        out.append(
            DependencyItem(
                entity_type="static_ingestion",
                entity_id=str(site_id),
                label=f"{int(si_n)} static ingestion config(s)",
                route_hint=None,
            )
        )
    us_n = db.scalar(select(func.count()).select_from(UserSite).where(UserSite.site_id == site_id)) or 0
    if int(us_n) > 0:
        out.append(
            DependencyItem(
                entity_type="user_site",
                entity_id=str(site_id),
                label=f"{int(us_n)} user–site assignment(s)",
                route_hint=None,
            )
        )
    return out


def device_delete_dependencies(
    db: Session, *, customer_id: uuid.UUID, device_id: uuid.UUID
) -> list[DependencyItem]:
    from app.models.raw_data_object import RawDataObject

    out: list[DependencyItem] = []
    raw_n = db.scalar(
        select(func.count()).select_from(RawDataObject).where(RawDataObject.device_id == device_id)
    )
    if raw_n and int(raw_n) > 0:
        out.append(
            DependencyItem(
                entity_type="raw_data_object",
                entity_id=str(device_id),
                label=f"{int(raw_n)} immutable raw archive row(s)",
                route_hint="/raw-data-objects",
            )
        )
    do_n = db.scalar(
        select(func.count()).select_from(DataObject).where(DataObject.device_id == device_id)
    )
    if do_n and int(do_n) > 0:
        out.append(
            DependencyItem(
                entity_type="data_object",
                entity_id=str(device_id),
                label=f"{int(do_n)} data_object(s)",
                route_hint=None,
            )
        )
    for d in check_device_in_use(db, customer_id=customer_id, device_id=device_id):
        out.append(
            DependencyItem(
                entity_type="dashboard",
                entity_id=str(d.id),
                label=d.name,
                route_hint=_hint_dashboard(d.id),
            )
        )
    return out


def dashboard_delete_dependencies(
    db: Session, *, customer_id: uuid.UUID, dashboard_id: uuid.UUID
) -> list[DependencyItem]:
    out: list[DependencyItem] = []
    prefs = list(
        db.scalars(
            select(DashboardUserPreference).where(
                DashboardUserPreference.primary_dashboard_id == dashboard_id
            )
        ).all()
    )
    if prefs:
        out.append(
            DependencyItem(
                entity_type="dashboard",
                entity_id=str(dashboard_id),
                label=f"primary dashboard for {len(prefs)} user(s)",
                route_hint=_hint_dashboard(dashboard_id),
            )
        )
    return out


def published_service_delete_dependencies(
    db: Session, *, customer_id: uuid.UUID, service_id: uuid.UUID
) -> list[DependencyItem]:
    row = db.get(PublishedService, service_id)
    if not row or row.customer_id != customer_id:
        return []
    out: list[DependencyItem] = []
    if (row.status or "").lower() == "active":
        out.append(
            DependencyItem(
                entity_type="published_service",
                entity_id=str(row.id),
                label="Service is active; stop dispatch before delete",
                route_hint=_hint_published(row.id),
            )
        )
    log_n = (
        db.scalar(
            select(func.count())
            .select_from(PublishedServiceDeliveryLog)
            .where(PublishedServiceDeliveryLog.published_service_id == service_id)
        )
        or 0
    )
    if int(log_n) > 0:
        out.append(
            DependencyItem(
                entity_type="summary",
                entity_id=str(service_id),
                label=f"{int(log_n)} immutable delivery log row(s)",
                route_hint=_hint_published(service_id),
            )
        )
    return out
