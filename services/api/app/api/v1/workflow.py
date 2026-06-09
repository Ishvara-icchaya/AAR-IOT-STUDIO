"""Workflow CRUD, validation, test, publish, executions, results."""

from __future__ import annotations

import logging
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.access_control import ensure_site_in_tenant, user_may_access_site
from app.services.permission_service import ensure_site_permission, site_ids_with_permission
from app.api.deps import get_current_user
from app.core.data_object_lifecycle import DATA_PUBLISHED
from app.core.pipeline_log import emit as pipeline_emit
from app.core.workflow_lifecycle import WF_DRAFT, WF_PUBLISHED, WF_STOPPED, WF_VALIDATED
from app.db.session import get_db
from app.models.data_object import DataObject
from app.models.data_object_detail import DataObjectDetail
from app.models.static_ingestion import StaticIngestion
from app.models.device import Device
from app.models.user import User
from app.models.workflow import Workflow
from app.models.workflow_execution import WorkflowExecution
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.workflow_graph import (
    DataObjectSourceListResponse,
    ResultObjectPreview,
    WorkflowCreate,
    WorkflowExecutionListResponse,
    WorkflowListItem,
    WorkflowListResponse,
    WorkflowPreviewResponse,
    WorkflowRead,
    WorkflowResultListResponse,
    WorkflowTestRequest,
    WorkflowTestResponse,
    WorkflowUpdate,
    WorkflowValidateResponse,
)
from app.schemas.integrity import DependenciesListResponse, raise_conflict_if_in_use
from app.services.dependency_service import workflow_delete_dependencies
from app.services.workflow_result_query import order_by_metadata_recency as order_result_objects_by_recency
from app.services.functional_audit_alert import emit_functional_audit_alert
from app.services.lifecycle_actions import archive_workflow, deactivate_workflow, reactivate_workflow
from app.services.workflow_graph_run import WorkflowGraphError, execute_graph
from app.services.workflow_ops import duplicate_workflow, load_workflow_eager, replace_workflow_graph
from app.services.workflow_validation import full_validation_errors, validate_workflow_graph

router = APIRouter()
log = logging.getLogger(__name__)


def _ensure_workflow_access(
    db: Session, user: User, wf: Workflow | None
) -> Workflow:
    if not wf:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    if wf.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow not found")
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if wf.site_id and not user_may_access_site(user, wf.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    return wf


@router.get("/data-sources", response_model=DataObjectSourceListResponse)
def list_published_data_object_sources(
    site_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Published data_objects for workflow input binding (per site)."""
    allowed = site_ids_with_permission(db, user, "workflows.read")
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    stmt = (
        select(DataObject)
        .join(Device, Device.id == DataObject.device_id)
        .where(
            DataObject.customer_id == user.customer_id,
            Device.site_id == site_id,
            DataObject.lifecycle_status == DATA_PUBLISHED,
        )
        .order_by(DataObject.updated_at.desc())
        .limit(500)
    )
    rows = list(db.scalars(stmt).all())
    from app.schemas.workflow_graph import DataObjectSourceItem

    items = [
        DataObjectSourceItem(
            id=r.id,
            device_id=r.device_id,
            site_id=r.site_id,
            name=r.name,
            lifecycle_status=r.lifecycle_status,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    return DataObjectSourceListResponse(items=items)


@router.get("", response_model=WorkflowListResponse)
def list_workflows(
    site_id: uuid.UUID | None = None,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if allowed is not None and len(allowed) == 0:
        return WorkflowListResponse(items=[])
    stmt = (
        select(Workflow)
        .where(Workflow.customer_id == user.customer_id)
        .options(selectinload(Workflow.nodes))
        .order_by(Workflow.updated_at.desc())
    )
    if site_id is not None:
        stmt = stmt.where(Workflow.site_id == site_id)
        if not user_may_access_site(user, site_id, allowed):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    elif allowed is not None:
        stmt = stmt.where(Workflow.site_id.in_(allowed))
    if q and q.strip():
        stmt = stmt.where(Workflow.name.ilike(f"%{q.strip()}%"))

    wfs = list(db.scalars(stmt).unique().all())
    items: list[WorkflowListItem] = []
    for w in wfs:
        inc = sum(1 for n in w.nodes if n.node_type == "input")
        tc = sum(1 for n in w.nodes if n.node_type == "terminate")
        items.append(
            WorkflowListItem(
                id=w.id,
                site_id=w.site_id,
                name=w.name,
                lifecycle_status=w.lifecycle_status,
                version=w.version,
                is_published=w.is_published,
                updated_at=w.updated_at,
                input_count=inc,
                terminate_count=tc,
            )
        )
    pipeline_emit(log, component="api.workflow", action="list", status="ok", count=len(items))
    return WorkflowListResponse(items=items)


@router.post("", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
def create_workflow(
    body: WorkflowCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "workflows.read")
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    ensure_site_permission(db, user, body.site_id, "workflows.write")

    wf = Workflow(
        customer_id=user.customer_id,
        site_id=body.site_id,
        name=body.name,
        description=body.description,
        definition={},
        lifecycle_status=WF_DRAFT,
        version=1,
        is_published=False,
        created_by_user_id=user.id,
    )
    db.add(wf)
    db.flush()
    nodes_d = [n.model_dump(mode="python") for n in body.nodes]
    edges_d = [e.model_dump(mode="python") for e in body.edges]
    gerrs = validate_workflow_graph(
        db=db,
        customer_id=user.customer_id,
        site_id=body.site_id,
        workflow_id=wf.id,
        nodes=nodes_d,
        edges=edges_d,
    )
    if gerrs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="; ".join(gerrs))
    replace_workflow_graph(db, wf, body.nodes, body.edges)
    db.commit()
    wf = load_workflow_eager(db, wf.id)
    assert wf is not None
    out = WorkflowRead.model_validate(wf)
    pipeline_emit(log, component="api.workflow", action="create", status="ok", workflow_id=str(wf.id))
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="created",
        resource_type="Workflow",
        resource_label=wf.name,
        site_id=wf.site_id,
        device_id=None,
        resource_created_at=wf.created_at,
        resource_updated_at=wf.updated_at,
        source_object_type="workflow",
        source_object_id=wf.id,
    )
    return out


@router.get("/{workflow_id}", response_model=WorkflowRead)
def get_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    return WorkflowRead.model_validate(wf)


@router.put("/{workflow_id}", response_model=WorkflowRead)
def update_workflow(
    workflow_id: uuid.UUID,
    body: WorkflowUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    if wf.is_published:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Stop publish before editing workflow graph",
        )

    if body.site_id is not None:
        allowed = site_ids_with_permission(db, user, "workflows.read")
        site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
        if not site:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
        if not user_may_access_site(user, body.site_id, allowed):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
        ensure_site_permission(db, user, body.site_id, "workflows.write")
        wf.site_id = body.site_id
    if body.name is not None:
        wf.name = body.name
    if body.description is not None:
        wf.description = body.description

    if body.nodes is not None and body.edges is not None:
        nodes_d = [n.model_dump(mode="python") for n in body.nodes]
        edges_d = [e.model_dump(mode="python") for e in body.edges]
        gerrs = validate_workflow_graph(
            db=db,
            customer_id=user.customer_id,
            site_id=wf.site_id,
            workflow_id=wf.id,
            nodes=nodes_d,
            edges=edges_d,
        )
        if gerrs:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="; ".join(gerrs))
        replace_workflow_graph(db, wf, body.nodes, body.edges)
        wf.version = (wf.version or 1) + 1

    db.commit()
    wf = load_workflow_eager(db, workflow_id)
    assert wf is not None
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="updated",
        resource_type="Workflow",
        resource_label=wf.name,
        site_id=wf.site_id,
        device_id=None,
        resource_created_at=wf.created_at,
        resource_updated_at=wf.updated_at,
        source_object_type="workflow",
        source_object_id=wf.id,
    )
    return WorkflowRead.model_validate(wf)


@router.get("/{workflow_id}/dependencies", response_model=DependenciesListResponse)
def get_workflow_dependencies(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = db.get(Workflow, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    deps = workflow_delete_dependencies(db, customer_id=user.customer_id, workflow_id=workflow_id)
    return DependenciesListResponse(dependencies=deps)


@router.post("/{workflow_id}/deactivate")
def post_deactivate_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = db.get(Workflow, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    deactivate_workflow(db, wf)
    db.commit()
    db.refresh(wf)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="deactivated",
        resource_type="Workflow",
        resource_label=wf.name,
        site_id=wf.site_id,
        device_id=None,
        resource_created_at=wf.created_at,
        resource_updated_at=wf.updated_at,
        source_object_type="workflow",
        source_object_id=wf.id,
    )
    return {"id": str(wf.id), "lifecycle_status": wf.lifecycle_status, "is_published": wf.is_published}


@router.post("/{workflow_id}/reactivate")
def post_reactivate_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = db.get(Workflow, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    reactivate_workflow(db, wf)
    db.commit()
    db.refresh(wf)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="reactivated",
        resource_type="Workflow",
        resource_label=wf.name,
        site_id=wf.site_id,
        device_id=None,
        resource_created_at=wf.created_at,
        resource_updated_at=wf.updated_at,
        source_object_type="workflow",
        source_object_id=wf.id,
    )
    return {"id": str(wf.id), "lifecycle_status": wf.lifecycle_status, "is_published": wf.is_published}


@router.post("/{workflow_id}/archive")
def post_archive_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = db.get(Workflow, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    archive_workflow(db, wf)
    db.commit()
    db.refresh(wf)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="archived",
        resource_type="Workflow",
        resource_label=wf.name,
        site_id=wf.site_id,
        device_id=None,
        resource_created_at=wf.created_at,
        resource_updated_at=wf.updated_at,
        source_object_type="workflow",
        source_object_id=wf.id,
    )
    return {"id": str(wf.id), "lifecycle_status": wf.lifecycle_status, "is_published": wf.is_published}


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = db.get(Workflow, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    if wf.is_published or wf.lifecycle_status == WF_PUBLISHED:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Stop publish before deleting workflow",
        )
    deps = workflow_delete_dependencies(db, customer_id=user.customer_id, workflow_id=workflow_id)
    raise_conflict_if_in_use(
        deps,
        message="Workflow cannot be deleted while dependencies exist",
        deactivate_url=f"/workflows/{workflow_id}/deactivate",
    )
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="deleted",
        resource_type="Workflow",
        resource_label=wf.name,
        site_id=wf.site_id,
        device_id=None,
        resource_created_at=wf.created_at,
        resource_updated_at=wf.updated_at,
        source_object_type="workflow",
        source_object_id=wf.id,
    )
    db.delete(wf)
    db.commit()
    return None


@router.post("/{workflow_id}/duplicate", response_model=WorkflowRead)
def duplicate_workflow_route(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    new_name = f"Copy of {wf.name}"[:255]
    nw = duplicate_workflow(db, wf, new_name=new_name, user_id=user.id)
    db.commit()
    nw2 = load_workflow_eager(db, nw.id)
    assert nw2 is not None
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="created",
        resource_type="Workflow",
        resource_label=nw2.name,
        site_id=nw2.site_id,
        device_id=None,
        resource_created_at=nw2.created_at,
        resource_updated_at=nw2.updated_at,
        source_object_type="workflow",
        source_object_id=nw2.id,
    )
    return WorkflowRead.model_validate(nw2)


@router.post("/{workflow_id}/validate", response_model=WorkflowValidateResponse)
def validate_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    errs = full_validation_errors(db, user.customer_id, wf)
    if not errs:
        wf.lifecycle_status = WF_VALIDATED
        db.commit()
    return WorkflowValidateResponse(valid=len(errs) == 0, errors=errs)


@router.post("/{workflow_id}/test", response_model=WorkflowTestResponse)
def test_workflow(
    workflow_id: uuid.UUID,
    body: WorkflowTestRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    nodes = [
        {"id": n.id, "node_type": n.node_type, "config_json": dict(n.config_json or {})}
        for n in wf.nodes
    ]
    edges = [
        {"source_node_id": e.source_node_id, "target_node_id": e.target_node_id} for e in wf.edges
    ]

    sample = deepcopy(body.sample_payload) if body.sample_payload is not None else None
    use_latest_observed = bool(body.use_latest_observed_payload)

    def load_obj(did: uuid.UUID) -> dict[str, Any]:
        try:
            if sample is not None:
                return deepcopy(sample)
            row = db.get(DataObject, did)
            if not row or row.customer_id != user.customer_id:
                raise WorkflowGraphError("data_object not found")
            if row.lifecycle_status != DATA_PUBLISHED:
                raise WorkflowGraphError("data_object not published")
            if use_latest_observed:
                detail = db.scalars(
                    select(DataObjectDetail)
                    .where(DataObjectDetail.data_object_id == did)
                    .order_by(DataObjectDetail.observed_at.desc())
                    .limit(1)
                ).first()
                if detail is not None:
                    out = dict(detail.payload_json or {})
                    out["_kpi"] = dict(detail.kpi_json or {})
                    if detail.health_status:
                        out["_health_status"] = detail.health_status
                    return out
            out = dict(row.payload or {})
            out["_kpi"] = dict(row.kpi_json or {})
            if row.health_status:
                out["_health_status"] = row.health_status
            return out
        except WorkflowGraphError:
            raise
        except Exception as e:
            raise WorkflowGraphError(str(e)) from e

    def load_static(sid: uuid.UUID) -> dict[str, Any]:
        row = db.get(StaticIngestion, sid)
        if not row or row.customer_id != user.customer_id:
            raise WorkflowGraphError("static ingestion not found")
        if wf.site_id and row.site_id != wf.site_id:
            raise WorkflowGraphError("static ingestion site mismatch")
        now = datetime.now(timezone.utc)
        end = row.end_at
        if end is not None:
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            if end <= now:
                raise WorkflowGraphError("static ingestion has passed its end date")
        return dict(row.payload_json or {})

    outs, results, err = execute_graph(
        nodes=nodes, edges=edges, load_data_object=load_obj, load_static_ingestion=load_static
    )
    st = "success"
    if err == "filtered_out":
        st = "filtered_out"
    elif err:
        st = "error"
    return WorkflowTestResponse(
        workflow_id=wf.id,
        status=st,
        node_outputs=outs,
        result_objects=[ResultObjectPreview(**r) for r in results],
        error=err,
    )


@router.post("/{workflow_id}/publish", response_model=WorkflowRead)
def publish_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    errs = full_validation_errors(db, user.customer_id, wf)
    if errs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"message": "validation failed", "errors": errs},
        )
    wf.lifecycle_status = WF_PUBLISHED
    wf.is_published = True
    db.commit()
    wf = load_workflow_eager(db, workflow_id)
    assert wf is not None
    return WorkflowRead.model_validate(wf)


@router.post("/{workflow_id}/stop-publish", response_model=WorkflowRead)
def stop_publish_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    if wf.site_id:
        ensure_site_permission(db, user, wf.site_id, "workflows.write")
    wf.lifecycle_status = WF_STOPPED
    wf.is_published = False
    db.commit()
    wf = load_workflow_eager(db, workflow_id)
    assert wf is not None
    return WorkflowRead.model_validate(wf)


@router.get("/{workflow_id}/executions", response_model=WorkflowExecutionListResponse)
def list_executions(
    workflow_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = db.get(Workflow, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    stmt = (
        select(WorkflowExecution)
        .where(WorkflowExecution.workflow_id == workflow_id)
        .order_by(WorkflowExecution.started_at.desc())
        .limit(limit)
    )
    rows = list(db.scalars(stmt).all())
    from app.schemas.workflow_graph import WorkflowExecutionRead

    return WorkflowExecutionListResponse(
        items=[WorkflowExecutionRead.model_validate(r) for r in rows]
    )


@router.get("/{workflow_id}/result-objects", response_model=WorkflowResultListResponse)
def list_result_objects(
    workflow_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = db.get(Workflow, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    stmt = (
        select(WorkflowResultObject)
        .where(WorkflowResultObject.workflow_id == workflow_id)
        .order_by(order_result_objects_by_recency())
        .limit(limit)
    )
    rows = list(db.scalars(stmt).all())
    from app.schemas.workflow_graph import WorkflowResultObjectRead

    return WorkflowResultListResponse(
        items=[WorkflowResultObjectRead.model_validate(r) for r in rows],
        governance={
            "operationalReadPolicy": "active_shared_per_device",
            "note": (
                "Result rows are not stamped with device_versions.id; resolve the active shared cut per "
                "bound device via GET /devices/{device_id}/operational-device-version."
            ),
        },
    )


@router.get("/{workflow_id}/preview", response_model=WorkflowPreviewResponse)
def preview_workflow(
    workflow_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    wf = load_workflow_eager(db, workflow_id)
    wf = _ensure_workflow_access(db, user, wf)
    errs = full_validation_errors(db, user.customer_id, wf)
    return WorkflowPreviewResponse(workflow=WorkflowRead.model_validate(wf), validation_errors=errs)
