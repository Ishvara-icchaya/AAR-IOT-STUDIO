"""Canonical read access for frozen result_object (v1) by id."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.api.deps import get_current_user
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.user import User
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.integrity import DependenciesListResponse, raise_conflict_if_in_use
from app.schemas.result_object_contract import ResultObjectV1
from app.services.dependency_service import result_object_delete_dependencies
from app.services.lifecycle_actions import archive_result_object, deactivate_result_object, reactivate_result_object

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/{result_object_id}", response_model=ResultObjectV1)
def get_result_object(
    result_object_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(WorkflowResultObject, result_object_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "result_object not found")
    allowed = allowed_site_ids_for_user(db, user)
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
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
    allowed = allowed_site_ids_for_user(db, user)
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
    allowed = allowed_site_ids_for_user(db, user)
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
    allowed = allowed_site_ids_for_user(db, user)
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
    allowed = allowed_site_ids_for_user(db, user)
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
    allowed = allowed_site_ids_for_user(db, user)
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
