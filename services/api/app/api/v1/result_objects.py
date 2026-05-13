"""Canonical read access for frozen result_object (v1) by id."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access_control import user_may_access_site
from app.services.permission_service import site_ids_with_permission
from app.api.deps import get_current_user
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.user import User
from app.models.workflow_result_object import WorkflowResultObject
from app.models.workflow_result_object_detail import WorkflowResultObjectDetail
from app.schemas.integrity import DependenciesListResponse, raise_conflict_if_in_use
from app.schemas.payload_field_metadata import PayloadFieldEntry, PayloadFieldMetadataResponse
from app.schemas.result_object_contract import (
    ResultObjectV1,
    WorkflowResultObjectDetailListResponse,
    WorkflowResultObjectDetailRead,
)
from app.services.dependency_service import result_object_delete_dependencies
from app.services.lifecycle_actions import archive_result_object, deactivate_result_object, reactivate_result_object
from app.services.payload_field_catalog import build_payload_field_entries

router = APIRouter()
log = logging.getLogger(__name__)


def _require_result_object_access(
    db: Session,
    user: User,
    result_object_id: uuid.UUID,
) -> WorkflowResultObject:
    row = db.get(WorkflowResultObject, result_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "result_object not found")
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    return row


@router.get("/{result_object_id}/field-metadata", response_model=PayloadFieldMetadataResponse)
def get_result_object_field_metadata(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Structured field list for dashboard / binding authoring (Phase E)."""
    row = _require_result_object_access(db, user, result_object_id)
    raw = build_payload_field_entries(dict(row.payload_json or {}))
    return PayloadFieldMetadataResponse(items=[PayloadFieldEntry.model_validate(x) for x in raw])


@router.get("/{result_object_id}/details", response_model=WorkflowResultObjectDetailListResponse)
def list_result_object_details(
    result_object_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Observed history for drill-down (metadata is ``GET /result-objects/{id}``)."""
    _require_result_object_access(db, user, result_object_id)
    total = int(
        db.scalar(
            select(func.count())
            .select_from(WorkflowResultObjectDetail)
            .where(WorkflowResultObjectDetail.workflow_result_object_id == result_object_id)
        )
        or 0
    )
    stmt = (
        select(WorkflowResultObjectDetail)
        .where(WorkflowResultObjectDetail.workflow_result_object_id == result_object_id)
        .order_by(WorkflowResultObjectDetail.observed_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = list(db.scalars(stmt).all())
    return WorkflowResultObjectDetailListResponse(
        items=[WorkflowResultObjectDetailRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{result_object_id}/details/{detail_id}", response_model=WorkflowResultObjectDetailRead)
def get_result_object_detail(
    result_object_id: uuid.UUID,
    detail_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_result_object_access(db, user, result_object_id)
    d = db.get(WorkflowResultObjectDetail, detail_id)
    if not d or d.workflow_result_object_id != result_object_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "detail not found")
    return WorkflowResultObjectDetailRead.model_validate(d)


@router.get("/{result_object_id}", response_model=ResultObjectV1)
def get_result_object(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _require_result_object_access(db, user, result_object_id)
    pipeline_emit(
        log,
        component="api.result_objects",
        action="get",
        status="ok",
        result_object_id=str(result_object_id),
    )
    return ResultObjectV1.model_validate(row)


@router.get("/{result_object_id}/dependencies", response_model=DependenciesListResponse)
def get_result_object_dependencies(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(WorkflowResultObject, result_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "result_object not found")
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    deps = result_object_delete_dependencies(db, customer_id=user.customer_id, result_object_id=result_object_id)
    return DependenciesListResponse(dependencies=deps)


@router.post("/{result_object_id}/deactivate")
def post_deactivate_result_object(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(WorkflowResultObject, result_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "result_object not found")
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    deactivate_result_object(db, row)
    db.commit()
    db.refresh(row)
    return {"id": str(row.id), "operational_status": row.operational_status}


@router.post("/{result_object_id}/reactivate")
def post_reactivate_result_object(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(WorkflowResultObject, result_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "result_object not found")
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    reactivate_result_object(db, row)
    db.commit()
    db.refresh(row)
    return {"id": str(row.id), "operational_status": row.operational_status}


@router.post("/{result_object_id}/archive")
def post_archive_result_object(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(WorkflowResultObject, result_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "result_object not found")
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    archive_result_object(db, row)
    db.commit()
    db.refresh(row)
    return {"id": str(row.id), "operational_status": row.operational_status}


@router.delete("/{result_object_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_result_object(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(WorkflowResultObject, result_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "result_object not found")
    allowed = site_ids_with_permission(db, user, "workflows.read")
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    deps = result_object_delete_dependencies(db, customer_id=user.customer_id, result_object_id=result_object_id)
    raise_conflict_if_in_use(
        deps,
        message="Result object is used by other resources",
        deactivate_url=f"/result-objects/{result_object_id}/deactivate",
    )
    db.delete(row)
    db.commit()
    pipeline_emit(
        log,
        component="api.result_objects",
        action="deleted",
        status="ok",
        result_object_id=str(result_object_id),
    )
    return None
