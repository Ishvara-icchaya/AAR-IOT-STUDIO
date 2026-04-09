import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.user import User
from app.schemas.alert import AlertListResponse, AlertRead, AlertUnacknowledgedSummary
from app.services.alert_service import (
    AlertAccessDenied,
    AlertForbidden,
    acknowledge_alert,
    list_alerts,
    require_alert,
)
from app.services.alert_summary_service import unacknowledged_summary

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/summary/unacknowledged", response_model=AlertUnacknowledgedSummary)
def get_unacknowledged_summary(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    out = unacknowledged_summary(db, user)
    pipeline_emit(
        log,
        component="api.alerts",
        action="summary_unacknowledged",
        status="ok",
        total=out.total_unacknowledged,
    )
    return out


@router.get("", response_model=AlertListResponse)
def list_alerts_route(
    site_id: uuid.UUID | None = None,
    severity: str | None = None,
    category: str | None = None,
    acknowledged: bool | None = None,
    search: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    out = list_alerts(
        db,
        user,
        site_id=site_id,
        severity=severity,
        category=category,
        acknowledged=acknowledged,
        search=search,
        limit=limit,
        offset=offset,
    )
    pipeline_emit(
        log,
        component="api.alerts",
        action="list",
        status="ok",
        count=len(out.items),
        total=out.total,
    )
    return out


@router.get("/{alert_id}", response_model=AlertRead)
def get_alert_route(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        a = require_alert(db, user, alert_id)
    except AlertAccessDenied:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    except AlertForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    pipeline_emit(log, component="api.alerts", action="get", status="ok", alert_id=str(alert_id))
    return AlertRead.model_validate(a)


@router.post("/{alert_id}/acknowledge", response_model=AlertRead)
def acknowledge_alert_route(
    alert_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        a = acknowledge_alert(db, user, alert_id)
    except AlertAccessDenied:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    except AlertForbidden:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    pipeline_emit(log, component="api.alerts", action="acknowledge", status="ok", alert_id=str(alert_id))
    return AlertRead.model_validate(a)
