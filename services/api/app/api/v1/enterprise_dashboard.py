import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.api.deps import get_current_user
from app.core.dashboard_status import DASHBOARD_FROZEN
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.dashboard import Dashboard
from app.models.dashboard_user_preference import DashboardUserPreference
from app.models.user import User
from app.schemas.dashboard import DashboardLiveResponse
from app.services.dashboard_live import build_live_payload

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("", response_model=DashboardLiveResponse)
def get_enterprise_dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Primary frozen dashboard as live payload (Enterprise landing)."""
    pref = db.get(DashboardUserPreference, user.id)
    if not pref or not pref.primary_dashboard_id:
        pipeline_emit(
            log,
            component="api.enterprise_dashboard",
            action="primary_missing",
            status="ok",
        )
        return DashboardLiveResponse(
            dashboard={"state": "no_primary_dashboard"},
            widgets=[],
            rendered_at=datetime.now(timezone.utc).isoformat(),
            primary_dashboard_id=None,
        )

    d = db.get(Dashboard, pref.primary_dashboard_id)
    if not d or d.customer_id != user.customer_id:
        pref.primary_dashboard_id = None
        db.add(pref)
        db.commit()
        pipeline_emit(
            log,
            component="api.enterprise_dashboard",
            action="primary_stale_cleared",
            status="ok",
        )
        return DashboardLiveResponse(
            dashboard={"state": "no_primary_dashboard"},
            widgets=[],
            rendered_at=datetime.now(timezone.utc).isoformat(),
            primary_dashboard_id=None,
        )

    allowed = allowed_site_ids_for_user(db, user)
    if d.site_id and not user_may_access_site(user, d.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    if d.status != DASHBOARD_FROZEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Primary dashboard must be frozen",
        )

    meta = {
        "id": str(d.id),
        "name": d.name,
        "description": d.description,
        "status": d.status,
        "site_id": str(d.site_id) if d.site_id else None,
        "layout": dict(d.layout or {}),
    }
    bundle = build_live_payload(
        db,
        customer_id=user.customer_id,
        layout=dict(d.layout or {}),
        dashboard_meta=meta,
        dashboard_site_id=d.site_id,
    )
    pipeline_emit(
        log,
        component="api.enterprise_dashboard",
        action="primary_live",
        status="ok",
        dashboard_id=str(d.id),
    )
    return DashboardLiveResponse(
        dashboard=bundle["dashboard"],
        widgets=bundle["widgets"],
        rendered_at=bundle["rendered_at"],
        primary_dashboard_id=d.id,
    )


@router.get("/primary")
def primary_dashboard_legacy(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy shape — prefer GET /enterprise-dashboard."""
    pref = db.get(DashboardUserPreference, user.id)
    pid = str(pref.primary_dashboard_id) if pref and pref.primary_dashboard_id else None
    return {
        "primary_dashboard_id": pid,
        "site_health": {},
        "alerts_summary": {},
        "kpi_summary": {},
    }
