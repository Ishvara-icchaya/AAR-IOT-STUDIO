import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.api.deps import get_current_user
from app.core.dashboard_status import DASHBOARD_FROZEN
from app.core.pipeline_log import emit as pipeline_emit
from app.core.redis_sync import get_redis
from app.db.session import get_db
from app.models.dashboard import Dashboard
from app.models.dashboard_user_preference import DashboardUserPreference
from app.models.data_object import DataObject
from app.models.site import Site
from app.models.user import User
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.dashboard import (
    DashboardLiveResponse,
    EnterpriseSiteObjectCountRow,
    EnterpriseSiteObjectCountsResponse,
)
from app.services.dashboard_live import build_live_payload
from app.services.tenant_site_rollup import site_object_counts_with_redis

router = APIRouter()
log = logging.getLogger(__name__)

# Redis-backed hot cache: shared across API workers; short TTL keeps data fresh enough for ops views.
_ENT_DASH_TTL_SEC = 30
_ENT_COUNTS_TTL_SEC = 20


def _ent_dash_cache_key(user_id: uuid.UUID, dashboard_id: uuid.UUID) -> str:
    return f"aar:ent_dash:v1:{user_id}:{dashboard_id}"


def _ent_counts_cache_key(user_id: uuid.UUID, page: int, page_size: int) -> str:
    return f"aar:ent_counts:v1:{user_id}:{page}:{page_size}"


def _site_object_counts(
    db: Session,
    *,
    customer_id: uuid.UUID,
    allowed: list[uuid.UUID] | None,
    page: int,
    page_size: int,
) -> EnterpriseSiteObjectCountsResponse:
    if allowed is not None and len(allowed) == 0:
        return EnterpriseSiteObjectCountsResponse(items=[], total=0, page=page, page_size=page_size)

    do_sq = (
        select(
            DataObject.site_id.label("site_id"),
            func.count().label("do_cnt"),
        )
        .where(DataObject.customer_id == customer_id)
        .group_by(DataObject.site_id)
    ).subquery()

    ro_sq = (
        select(
            WorkflowResultObject.site_id.label("site_id"),
            func.count().label("ro_cnt"),
        )
        .where(WorkflowResultObject.customer_id == customer_id)
        .group_by(WorkflowResultObject.site_id)
    ).subquery()

    do_cnt = func.coalesce(do_sq.c.do_cnt, 0)
    ro_cnt = func.coalesce(ro_sq.c.ro_cnt, 0)
    total_cnt = do_cnt + ro_cnt

    site_filter = [Site.customer_id == customer_id]
    if allowed is not None:
        site_filter.append(Site.id.in_(allowed))

    total_stmt = select(func.count()).select_from(Site).where(*site_filter)
    total_rows = int(db.execute(total_stmt).scalar_one() or 0)

    stmt = (
        select(
            Site.id,
            Site.name,
            do_cnt.label("doc"),
            ro_cnt.label("roc"),
            total_cnt.label("tot"),
        )
        .select_from(Site)
        .outerjoin(do_sq, Site.id == do_sq.c.site_id)
        .outerjoin(ro_sq, Site.id == ro_sq.c.site_id)
        .where(*site_filter)
        .order_by(total_cnt.desc(), Site.name.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = db.execute(stmt).all()
    items: list[EnterpriseSiteObjectCountRow] = []
    for r in rows:
        sid, name, doc, roc, tot = r[0], r[1], int(r[2] or 0), int(r[3] or 0), int(r[4] or 0)
        items.append(
            EnterpriseSiteObjectCountRow(
                site_id=sid,
                site_name=name,
                data_object_count=doc,
                result_object_count=roc,
                total_count=tot,
            )
        )
    return EnterpriseSiteObjectCountsResponse(
        items=items,
        total=total_rows,
        page=page,
        page_size=page_size,
    )


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

    rds = get_redis()
    cache_key = _ent_dash_cache_key(user.id, d.id)
    if rds:
        try:
            raw = rds.get(cache_key)
            if raw:
                return DashboardLiveResponse.model_validate_json(raw)
        except Exception:
            log.debug("enterprise dashboard cache read failed", exc_info=True)

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
    resp = DashboardLiveResponse(
        dashboard=bundle["dashboard"],
        widgets=bundle["widgets"],
        rendered_at=bundle["rendered_at"],
        primary_dashboard_id=d.id,
    )
    if rds:
        try:
            rds.setex(cache_key, _ENT_DASH_TTL_SEC, resp.model_dump_json())
        except Exception:
            log.debug("enterprise dashboard cache write failed", exc_info=True)
    return resp


@router.get("/site-object-counts", response_model=EnterpriseSiteObjectCountsResponse)
def get_enterprise_site_object_counts(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(8, ge=1, le=50),
):
    """Per-site data_object and workflow_result_object counts; ordered by total desc (paginated)."""
    allowed = allowed_site_ids_for_user(db, user)
    rds = get_redis()
    ck = _ent_counts_cache_key(user.id, page, page_size)
    if rds:
        try:
            raw = rds.get(ck)
            if raw:
                return EnterpriseSiteObjectCountsResponse.model_validate_json(raw)
        except Exception:
            log.debug("enterprise site counts cache read failed", exc_info=True)

    rollup = site_object_counts_with_redis(
        db,
        customer_id=user.customer_id,
        allowed=allowed,
        page=page,
        page_size=page_size,
    )
    out = rollup if rollup is not None else _site_object_counts(
        db,
        customer_id=user.customer_id,
        allowed=allowed,
        page=page,
        page_size=page_size,
    )
    if rds:
        try:
            rds.setex(ck, _ENT_COUNTS_TTL_SEC, out.model_dump_json())
        except Exception:
            log.debug("enterprise site counts cache write failed", exc_info=True)
    return out


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
