"""Dashboard CRUD, freeze, live, sources, primary (per-user)."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.core.dashboard_status import DASHBOARD_DRAFT, DASHBOARD_FROZEN
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.dashboard import Dashboard
from app.models.dashboard_user_preference import DashboardUserPreference
from app.models.data_object import DataObject
from app.models.latest_device_state import LatestDeviceState
from app.models.endpoint import Endpoint
from app.models.resolved_device import ResolvedDevice
from app.services.data_object_query import order_by_metadata_recency
from app.services.workflow_result_query import order_by_metadata_recency as order_result_objects_by_recency
from app.models.device import Device
from app.models.device_endpoint import DeviceEndpoint
from app.models.user import User
from app.models.user_site import UserSite
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.dashboard_layout import iter_widgets
from app.schemas.dashboard import (
    ClearPrimaryDashboardResponse,
    DashboardCreate,
    DashboardFreezeResponse,
    DashboardListItem,
    DashboardListResponse,
    DashboardLiveResponse,
    DashboardRead,
    DashboardPreviewBody,
    DashboardShareRequest,
    DashboardShareUsersResponse,
    DashboardSourcesDataObjectsResponse,
    DashboardSourcesLatestDeviceStatesResponse,
    DashboardSourcesResolvedDeviceCollectionsResponse,
    DashboardResolvedDeviceCollectionResponse,
    DashboardSourcesResultObjectsResponse,
    DashboardUpdate,
    DataObjectSourceRow,
    LatestDeviceStateSourceRow,
    ResultObjectSourceRow,
)
from app.schemas.dashboard_widget_runtime import (
    DashboardRuntimeLayoutResponse,
    DashboardWidgetsResolveBatchRequest,
    DashboardWidgetsResolveBatchResponse,
)
from app.schemas.integrity import DependenciesListResponse, raise_conflict_if_in_use
from app.services.dependency_service import dashboard_delete_dependencies
from app.services.dashboard_default_template import default_ops_template_layout
from app.services.dashboard_live import build_live_payload
from app.services.dashboard_resolved_device_collection import (
    decode_cursor,
    list_collection_sources,
    query_collection_page,
)
from app.services.dashboard_resolve import build_dashboard_live_response
from app.services.dashboard_runtime_layout import build_runtime_layout_response
from app.services.dashboard_widget_resolve_batch import resolve_dashboard_widgets_batch
from app.services.lifecycle_actions import (
    archive_dashboard,
    clear_primary_dashboard_for_all_users,
    deactivate_dashboard,
    reactivate_dashboard,
)
from app.services.dashboard_validation import (
    validate_layout_for_save,
    validate_site_coherence,
    validate_sources_exist,
    validate_widgets_for_freeze,
)
from app.api.v1 import map_runtime

router = APIRouter()
router.include_router(map_runtime.router, prefix="/map-runtime", tags=["dashboard-map"])
log = logging.getLogger(__name__)


@router.get("/{dashboard_id}/runtime-layout", response_model=DashboardRuntimeLayoutResponse)
def get_dashboard_runtime_layout(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Canonical layout + widget definitions (no widget data). Use resolve-batch for data."""
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    return build_runtime_layout_response(
        dashboard_id=d.id,
        name=d.name,
        description=d.description,
        status=d.status,
        site_id=d.site_id,
        layout=dict(d.layout or {}),
    )


@router.post(
    "/runtime/widgets/resolve-batch",
    response_model=DashboardWidgetsResolveBatchResponse,
)
def post_dashboard_widgets_resolve_batch(
    body: DashboardWidgetsResolveBatchRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Canonical widget data path: backend-prepared payloads (camelCase envelope per widget)."""
    d = db.get(Dashboard, body.dashboard_id)
    d = _access_dashboard(db, user, d)
    return resolve_dashboard_widgets_batch(db, user, body)


def _access_dashboard(db: Session, user: User, d: Dashboard | None) -> Dashboard:
    if not d or d.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dashboard not found")
    allowed = allowed_site_ids_for_user(db, user)
    if d.site_id and not user_may_access_site(user, d.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    return d


def _is_primary(db: Session, user_id: uuid.UUID, dashboard_id: uuid.UUID) -> bool:
    pref = db.get(DashboardUserPreference, user_id)
    return bool(pref and pref.primary_dashboard_id == dashboard_id)


def _dashboard_read(db: Session, user: User, d: Dashboard) -> DashboardRead:
    return DashboardRead(
        id=d.id,
        customer_id=d.customer_id,
        site_id=d.site_id,
        name=d.name,
        description=d.description,
        status=d.status,
        layout=dict(d.layout or {}),
        created_by=d.created_by,
        created_at=d.created_at,
        updated_at=d.updated_at,
        is_primary=_is_primary(db, user.id, d.id),
    )


@router.get("/sources/data-objects", response_model=DashboardSourcesDataObjectsResponse)
def list_data_object_sources(
    site_id: uuid.UUID = Query(...),
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    stmt = (
        select(DataObject)
        .join(Device, Device.id == DataObject.device_id)
        .where(DataObject.customer_id == user.customer_id, Device.site_id == site_id)
        .order_by(order_by_metadata_recency())
        .limit(limit)
    )
    rows = list(db.scalars(stmt).all())
    items = [
        DataObjectSourceRow(
            id=r.id,
            device_id=r.device_id,
            site_id=site_id,
            name=r.name,
            lifecycle_status=r.lifecycle_status,
            updated_at=r.updated_at,
            latest_seen_at=r.latest_seen_at,
        )
        for r in rows
    ]
    return DashboardSourcesDataObjectsResponse(items=items)


@router.get("/sources/result-objects", response_model=DashboardSourcesResultObjectsResponse)
def list_result_object_sources(
    site_id: uuid.UUID = Query(...),
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    stmt = (
        select(WorkflowResultObject)
        .where(
            WorkflowResultObject.customer_id == user.customer_id,
            WorkflowResultObject.site_id == site_id,
        )
        .order_by(order_result_objects_by_recency())
        .limit(limit)
    )
    rows = list(db.scalars(stmt).all())
    items = [
        ResultObjectSourceRow(
            id=r.id,
            workflow_id=r.workflow_id,
            result_object_name=r.result_object_name,
            site_id=r.site_id,
            created_at=r.created_at,
            latest_seen_at=r.latest_seen_at,
        )
        for r in rows
    ]
    return DashboardSourcesResultObjectsResponse(items=items)


@router.get("/sources/latest-device-states", response_model=DashboardSourcesLatestDeviceStatesResponse)
def list_latest_device_state_sources(
    site_id: uuid.UUID = Query(...),
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    stmt = (
        select(LatestDeviceState, ResolvedDevice.device_label, Endpoint.endpoint_name, Device.name)
        .outerjoin(
            ResolvedDevice,
            and_(
                ResolvedDevice.id == LatestDeviceState.resolved_device_id,
                ResolvedDevice.customer_id == LatestDeviceState.customer_id,
            ),
        )
        .outerjoin(
            Endpoint,
            and_(Endpoint.id == LatestDeviceState.endpoint_id, Endpoint.customer_id == LatestDeviceState.customer_id),
        )
        .outerjoin(DeviceEndpoint, DeviceEndpoint.id == Endpoint.device_endpoint_id)
        .outerjoin(Device, Device.id == DeviceEndpoint.device_id)
        .where(LatestDeviceState.customer_id == user.customer_id, LatestDeviceState.site_id == site_id)
        .order_by(LatestDeviceState.updated_at.desc())
        .limit(limit)
    )
    rows = list(db.execute(stmt).all())
    items = [
        LatestDeviceStateSourceRow(
            id=st.id,
            site_id=st.site_id,
            endpoint_id=st.endpoint_id,
            resolved_device_id=st.resolved_device_id,
            object_name=st.object_name,
            updated_at=st.updated_at,
            device_label=rd_label if isinstance(rd_label, str) and rd_label.strip() else None,
            endpoint_name=ep_name if isinstance(ep_name, str) and ep_name.strip() else None,
            device_name=dv_name if isinstance(dv_name, str) and dv_name.strip() else None,
        )
        for st, rd_label, ep_name, dv_name in rows
    ]
    return DashboardSourcesLatestDeviceStatesResponse(items=items)


@router.get(
    "/sources/resolved-device-collections",
    response_model=DashboardSourcesResolvedDeviceCollectionsResponse,
)
def list_resolved_device_collection_sources(
    site_id: uuid.UUID = Query(...),
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    items = list_collection_sources(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        limit=limit,
    )
    return DashboardSourcesResolvedDeviceCollectionsResponse(items=items)


@router.get(
    "/runtime/resolved-device-collection",
    response_model=DashboardResolvedDeviceCollectionResponse,
)
def get_runtime_resolved_device_collection(
    site_id: uuid.UUID = Query(...),
    endpoint_id: uuid.UUID = Query(...),
    object_name: str = Query(..., min_length=1, max_length=255),
    lifecycle_status: str | None = Query(None),
    health_status: str | None = Query(None),
    device_type: str | None = Query(None),
    limit: int = Query(25, ge=1, le=500),
    cursor: str | None = Query(None),
    require_location: bool = Query(
        False,
        description="When true, only rows with non-empty location_json.lat/lon are returned; "
        "summary.excluded_missing_location counts deduped devices missing coordinates.",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    ep = db.get(Endpoint, endpoint_id)
    if not ep or ep.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    if ep.site_id != site_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "endpoint.site_id does not match site_id")
    if not user_may_access_site(user, ep.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    decoded_cursor = None
    if cursor and cursor.strip():
        try:
            decoded_cursor = decode_cursor(cursor.strip())
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    rows, next_cursor, summary = query_collection_page(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        endpoint_id=endpoint_id,
        object_name=object_name,
        lifecycle_status=lifecycle_status,
        health_status=health_status,
        device_type=device_type,
        limit=limit,
        cursor=decoded_cursor,
        require_location=require_location,
    )
    items = [
        {
            "latest_device_state_id": st.id,
            "resolved_device_id": st.resolved_device_id,
            "device_label": rd.device_label if rd else None,
            "device_type": rd.device_type if rd else None,
            "lifecycle_status": st.lifecycle_status,
            "health_status": st.health_status,
            "last_event_ts": st.last_event_ts,
            "location_json": st.location_json,
            "identity_json": st.identity_json,
            "display_json": st.display_json,
            "kpi_json": st.kpi_json,
            "health_json": st.health_json,
            "updated_at": st.updated_at,
            "scrubbed_event_id": st.scrubbed_event_id,
        }
        for st, rd in rows
    ]
    return DashboardResolvedDeviceCollectionResponse(
        items=items,
        summary=summary,
        next_cursor=next_cursor,
        rollups={},
        trends={},
    )


@router.get("/resolved-live", response_model=DashboardLiveResponse)
def get_resolved_dashboard_live(
    site_id: uuid.UUID | None = Query(None, description="Narrow synthetic ops widgets to one site."),
    hours: int | None = Query(
        None,
        ge=1,
        le=24 * 60,
        description="If set, filter recent alerts/activity to this many past hours (synthetic path).",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Primary frozen dashboard when valid; otherwise synthetic Operations Overview."""
    return build_dashboard_live_response(db, user, scope_site_id=site_id, scope_hours=hours)


@router.get("", response_model=DashboardListResponse)
def list_dashboards(
    site_id: uuid.UUID | None = None,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and len(allowed) == 0:
        return DashboardListResponse(items=[])
    stmt = select(Dashboard).where(Dashboard.customer_id == user.customer_id)
    if site_id is not None:
        stmt = stmt.where(Dashboard.site_id == site_id)
        if not user_may_access_site(user, site_id, allowed):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    elif allowed is not None:
        stmt = stmt.where(Dashboard.site_id.in_(allowed))
    if q and q.strip():
        stmt = stmt.where(Dashboard.name.ilike(f"%{q.strip()}%"))
    stmt = stmt.order_by(Dashboard.updated_at.desc())
    rows = list(db.scalars(stmt).all())
    items = [
        DashboardListItem(
            id=d.id,
            site_id=d.site_id,
            name=d.name,
            status=d.status,
            updated_at=d.updated_at,
            is_primary=_is_primary(db, user.id, d.id),
        )
        for d in rows
    ]
    pipeline_emit(log, component="api.dashboard", action="list", status="ok", count=len(items))
    return DashboardListResponse(items=items)


@router.post("/clear-primary", response_model=ClearPrimaryDashboardResponse)
def clear_primary_dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear this user's primary dashboard (Enterprise landing shows no_primary_dashboard)."""
    pref = db.get(DashboardUserPreference, user.id)
    if pref:
        pref.primary_dashboard_id = None
        db.add(pref)
        db.commit()
    pipeline_emit(
        log,
        component="api.dashboard",
        action="primary_cleared",
        status="ok",
        user_id=str(user.id),
    )
    return ClearPrimaryDashboardResponse(primary_dashboard_id=None)


@router.post("", response_model=DashboardRead, status_code=status.HTTP_201_CREATED)
def create_dashboard(
    body: DashboardCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    layout_in = dict(body.layout or {})
    if len(iter_widgets(layout_in)) == 0:
        layout_in = default_ops_template_layout(site_id=body.site_id)
    errs = validate_layout_for_save(layout=layout_in, site_id=body.site_id, require_widgets=False)
    if errs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"errors": errs})
    d = Dashboard(
        customer_id=user.customer_id,
        site_id=body.site_id,
        name=body.name,
        description=body.description,
        layout=layout_in,
        status=DASHBOARD_DRAFT,
        created_by=user.id,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    pipeline_emit(
        log,
        component="api.dashboard",
        action="created",
        status="ok",
        dashboard_id=str(d.id),
        user_id=str(user.id),
    )
    return _dashboard_read(db, user, d)


@router.get("/{dashboard_id}", response_model=DashboardRead)
def get_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    return _dashboard_read(db, user, d)


@router.put("/{dashboard_id}", response_model=DashboardRead)
def update_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    if d.status == DASHBOARD_FROZEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Unfreeze dashboard before editing",
        )
    if body.site_id is not None:
        allowed = allowed_site_ids_for_user(db, user)
        site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
        if not site:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
        if not user_may_access_site(user, body.site_id, allowed):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
        d.site_id = body.site_id
    if body.name is not None:
        d.name = body.name
    if body.description is not None:
        d.description = body.description
    if body.layout is not None:
        layout = dict(body.layout)
        errs = validate_layout_for_save(layout=layout, site_id=d.site_id, require_widgets=False)
        if errs:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"errors": errs})
        d.layout = layout
    db.commit()
    db.refresh(d)
    pipeline_emit(
        log,
        component="api.dashboard",
        action="updated",
        status="ok",
        dashboard_id=str(d.id),
        user_id=str(user.id),
    )
    return _dashboard_read(db, user, d)


@router.post("/{dashboard_id}/reset-default-layout", response_model=DashboardRead)
def reset_dashboard_default_layout(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace draft layout with the default Operations Overview template (id/name unchanged)."""
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    if d.status == DASHBOARD_FROZEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Unfreeze the dashboard before resetting its layout.",
        )
    if not d.site_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Dashboard must have a site to apply the template.")
    layout = default_ops_template_layout(site_id=d.site_id)
    errs = validate_layout_for_save(layout=layout, site_id=d.site_id, require_widgets=False)
    if errs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"errors": errs})
    d.layout = layout
    db.add(d)
    db.commit()
    db.refresh(d)
    pipeline_emit(
        log,
        component="api.dashboard",
        action="reset_default_layout",
        status="ok",
        dashboard_id=str(d.id),
        user_id=str(user.id),
    )
    return _dashboard_read(db, user, d)


@router.get("/{dashboard_id}/dependencies", response_model=DependenciesListResponse)
def get_dashboard_dependencies(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    deps = dashboard_delete_dependencies(db, customer_id=user.customer_id, dashboard_id=dashboard_id)
    return DependenciesListResponse(dependencies=deps)


@router.post("/{dashboard_id}/deactivate")
def post_deactivate_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    deactivate_dashboard(db, d)
    db.commit()
    db.refresh(d)
    return {"id": str(d.id), "status": d.status}


@router.post("/{dashboard_id}/reactivate")
def post_reactivate_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    reactivate_dashboard(db, d)
    db.commit()
    db.refresh(d)
    return {"id": str(d.id), "status": d.status}


@router.post("/{dashboard_id}/archive")
def post_archive_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    archive_dashboard(db, d)
    db.commit()
    db.refresh(d)
    return {"id": str(d.id), "status": d.status}


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    clear_primary_dashboard_for_all_users(db, dashboard_id=dashboard_id)
    db.flush()
    deps = dashboard_delete_dependencies(db, customer_id=user.customer_id, dashboard_id=dashboard_id)
    raise_conflict_if_in_use(
        deps,
        message="Dashboard cannot be deleted while it is still referenced",
        deactivate_url=f"/dashboards/{dashboard_id}/deactivate",
    )
    db.delete(d)
    db.commit()
    pipeline_emit(
        log,
        component="api.dashboard",
        action="deleted",
        status="ok",
        dashboard_id=str(dashboard_id),
        user_id=str(user.id),
    )
    return None


@router.post("/{dashboard_id}/duplicate", response_model=DashboardRead)
def duplicate_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    copy = Dashboard(
        customer_id=d.customer_id,
        site_id=d.site_id,
        name=f"Copy of {d.name}"[:255],
        description=d.description,
        layout=dict(d.layout or {}),
        status=DASHBOARD_DRAFT,
        created_by=user.id,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _dashboard_read(db, user, copy)


@router.post("/{dashboard_id}/freeze", response_model=DashboardFreezeResponse)
def freeze_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    layout = dict(d.layout or {})
    errs = validate_layout_for_save(layout=layout, site_id=d.site_id, require_widgets=True)
    errs += validate_sources_exist(db, customer_id=user.customer_id, layout=layout)
    errs += validate_site_coherence(
        dashboard_site_id=d.site_id, layout=layout, db=db, customer_id=user.customer_id
    )
    if len(iter_widgets(layout)) == 0:
        errs.append("at least one widget required before freeze")
    errs += validate_widgets_for_freeze(layout=layout)
    if errs:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"errors": errs})
    d.status = DASHBOARD_FROZEN
    db.commit()
    pipeline_emit(
        log,
        component="api.dashboard",
        action="frozen",
        status="ok",
        dashboard_id=str(d.id),
        user_id=str(user.id),
    )
    return DashboardFreezeResponse(id=d.id, status=d.status)


@router.post("/{dashboard_id}/unfreeze", response_model=DashboardRead)
def unfreeze_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    d.status = DASHBOARD_DRAFT
    db.commit()
    db.refresh(d)
    pipeline_emit(
        log,
        component="api.dashboard",
        action="unfrozen",
        status="ok",
        dashboard_id=str(d.id),
        user_id=str(user.id),
    )
    return _dashboard_read(db, user, d)


@router.post("/{dashboard_id}/set-primary", response_model=DashboardRead)
def set_primary_dashboard(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Exactly one primary per user: `dashboard_user_preferences.user_id` is the primary key."""
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    if d.status != DASHBOARD_FROZEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only frozen dashboards can be set as primary",
        )
    pref = db.get(DashboardUserPreference, user.id)
    if not pref:
        pref = DashboardUserPreference(user_id=user.id)
        db.add(pref)
    pref.primary_dashboard_id = d.id
    db.commit()
    db.refresh(d)
    pipeline_emit(
        log,
        component="api.dashboard",
        action="primary_set",
        status="ok",
        dashboard_id=str(d.id),
        user_id=str(user.id),
    )
    return _dashboard_read(db, user, d)


def _live_bundle(db: Session, user: User, d: Dashboard) -> dict:
    meta = {
        "id": str(d.id),
        "name": d.name,
        "description": d.description,
        "status": d.status,
        "site_id": str(d.site_id) if d.site_id else None,
        "layout": dict(d.layout or {}),
    }
    allowed = allowed_site_ids_for_user(db, user)
    return build_live_payload(
        db,
        customer_id=user.customer_id,
        layout=dict(d.layout or {}),
        dashboard_meta=meta,
        dashboard_site_id=d.site_id,
        allowed_site_ids=allowed,
    )


@router.get("/{dashboard_id}/live", response_model=DashboardLiveResponse)
def get_dashboard_live(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    if d.status != DASHBOARD_FROZEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Live view requires a frozen dashboard",
        )
    bundle = _live_bundle(db, user, d)
    pref = db.get(DashboardUserPreference, user.id)
    primary_id = d.id if pref and pref.primary_dashboard_id == d.id else None
    pipeline_emit(log, component="api.dashboard", action="live", status="ok", dashboard_id=str(d.id))
    return DashboardLiveResponse(
        dashboard=bundle["dashboard"],
        widgets=bundle["widgets"],
        rendered_at=bundle["rendered_at"],
        primary_dashboard_id=primary_id,
    )


@router.post("/{dashboard_id}/preview", response_model=DashboardLiveResponse)
def preview_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardPreviewBody | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve widget data even when dashboard is still draft (builder preview)."""
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    layout_use = dict(body.layout) if body and body.layout is not None else dict(d.layout or {})
    meta = {
        "id": str(d.id),
        "name": d.name,
        "description": d.description,
        "status": d.status,
        "site_id": str(d.site_id) if d.site_id else None,
        "layout": layout_use,
    }
    allowed = allowed_site_ids_for_user(db, user)
    bundle = build_live_payload(
        db,
        customer_id=user.customer_id,
        layout=layout_use,
        dashboard_meta=meta,
        dashboard_site_id=d.site_id,
        allowed_site_ids=allowed,
    )
    pref = db.get(DashboardUserPreference, user.id)
    primary_id = d.id if pref and pref.primary_dashboard_id == d.id else None
    return DashboardLiveResponse(
        dashboard=bundle["dashboard"],
        widgets=bundle["widgets"],
        rendered_at=bundle["rendered_at"],
        primary_dashboard_id=primary_id,
    )


@router.post("/{dashboard_id}/share", status_code=status.HTTP_204_NO_CONTENT)
def share_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardShareRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    d = _access_dashboard(db, user, d)
    for uid in body.user_ids:
        target = db.get(User, uid)
        if not target:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"User {uid} not found")
        if target.customer_id != user.customer_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="Share targets must belong to the same customer",
            )
        if d.site_id and not target.is_superuser:
            link = db.scalar(
                select(UserSite).where(UserSite.user_id == uid, UserSite.site_id == d.site_id)
            )
            if not link:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    detail=f"User {uid} is not assigned to this dashboard's site; cannot share",
                )
    pipeline_emit(
        log,
        component="api.dashboard",
        action="share_validated",
        status="ok",
        dashboard_id=str(dashboard_id),
        user_id=str(user.id),
        target_count=len(body.user_ids),
    )
    return None


@router.get("/{dashboard_id}/share-users", response_model=DashboardShareUsersResponse)
def list_share_users(
    dashboard_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    d = db.get(Dashboard, dashboard_id)
    _access_dashboard(db, user, d)
    return DashboardShareUsersResponse(items=[])
