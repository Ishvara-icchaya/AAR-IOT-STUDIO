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
from app.schemas.result_object_contract import ResultObjectV1
from app.services.dashboard_dependency_service import (
    check_result_object_in_use,
    resource_in_use_detail,
)

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
    blocked = check_result_object_in_use(db, customer_id=user.customer_id, result_object_id=result_object_id)
    if blocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=resource_in_use_detail(resource_label="result object", dashboards=blocked),
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
