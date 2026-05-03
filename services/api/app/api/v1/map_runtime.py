"""Map runtime: eligible objects, marker detail (builder + live)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.endpoint import Endpoint
from app.models.resolved_device import ResolvedDevice
from app.models.user import User
from app.services.dashboard_live import (
    _map_markers_site,
    build_map_marker_for_source,
    merge_latest_device_state_map_markers,
)
from app.services.map_intelligence_service import (
    build_device_path,
    build_expanded_intelligence,
    build_site_historical_sample_points,
)
from app.services.map_runtime_service import (
    aggregate_data_object_markers_by_device,
    compute_map_init_from_markers,
    internal_aggregator_visibility,
    list_eligible_map_objects,
    map_marker_detail,
    map_marker_to_light,
    markers_manual_sources,
    markers_with_redis_first,
)

router = APIRouter()


class MapEligibleItem(BaseModel):
    source_type: str
    source_id: str
    name: str
    lifecycle_status: str
    updated_at: str | None = None


class MapEligibleResponse(BaseModel):
    items: list[MapEligibleItem]


class MapMarkersResponse(BaseModel):
    markers: list[dict]


class MapMarkersQueryBody(BaseModel):
    """Unified marker fetch for dashboard map widgets (auto / manual / single). Replaces embedding markers in live payloads."""

    site_id: uuid.UUID
    latitude_field: str = "gps.lat"
    longitude_field: str = "gps.lon"
    kpi_fields: list[str] = []
    excluded_source_ids: list[str] = []
    device_ids: list[uuid.UUID] | None = None
    title_field: str | None = None
    health_field: str | None = None
    light: bool = True
    mode: str = "auto"
    included_sources: list[dict[str, Any]] | None = None
    single_source_type: str | None = None
    single_source_id: uuid.UUID | None = None
    aggregate_by_device: bool = False


class MapMarkersQueryResponse(BaseModel):
    markers: list[dict]
    map_init: dict | None = None


class MapDetailResponse(BaseModel):
    detail: dict


@router.get("/eligible", response_model=MapEligibleResponse)
def map_eligible_objects(
    site_id: uuid.UUID = Query(...),
    latitude_field: str = Query("gps.lat"),
    longitude_field: str = Query("gps.lon"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    rows = list_eligible_map_objects(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        lat_field=latitude_field,
        lon_field=longitude_field,
    )
    return MapEligibleResponse(
        items=[
            MapEligibleItem(
                source_type=r["source_type"],
                source_id=r["source_id"],
                name=r["name"],
                lifecycle_status=r["lifecycle_status"],
                updated_at=r.get("updated_at"),
            )
            for r in rows
        ]
    )


@router.get("/markers", response_model=MapMarkersResponse)
def map_markers(
    site_id: uuid.UUID = Query(...),
    latitude_field: str = Query("gps.lat"),
    longitude_field: str = Query("gps.lon"),
    kpi_fields: str = Query("", description="Comma-separated KPI paths"),
    excluded_source_ids: str = Query("", alias="excludedSourceIds"),
    device_ids: str = Query(
        "",
        alias="deviceIds",
        description="Comma-separated device UUIDs; when set, only data objects on these devices are included.",
    ),
    light: bool = Query(
        True,
        description="If true, omit KPI maps and long health text (use /detail on click).",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Runtime markers for a site (Redis-first, same shape as dashboard map widget when light=false)."""
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    kpi_list = [x.strip() for x in kpi_fields.split(",") if x.strip()]
    excluded = {str(x).strip() for x in excluded_source_ids.split(",") if str(x).strip()}
    allowed_devices: set[uuid.UUID] | None = None
    if device_ids.strip():
        allowed_devices = set()
        for part in device_ids.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                allowed_devices.add(uuid.UUID(part))
            except ValueError:
                continue
        if not allowed_devices:
            allowed_devices = None
    markers = markers_with_redis_first(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        lat_field=latitude_field,
        lon_field=longitude_field,
        kpi_fields=kpi_list,
        excluded=excluded,
        title_field=None,
        health_field=None,
        allowed_device_ids=allowed_devices,
        pg_markers_fn=_map_markers_site,
    )
    markers = merge_latest_device_state_map_markers(
        markers,
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        latf=latitude_field,
        lonf=longitude_field,
        kpi_fields=kpi_list,
        excluded=excluded,
        title_field=None,
        health_field=None,
    )
    if light:
        markers = [map_marker_to_light(m) for m in markers]
    return MapMarkersResponse(markers=markers)


@router.post("/markers/query", response_model=MapMarkersQueryResponse)
def map_markers_query(
    body: MapMarkersQueryBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve markers for dashboard map widgets without embedding large arrays in live widget payloads."""
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    mode = (body.mode or "auto").strip().lower()
    excluded = {str(x).strip() for x in body.excluded_source_ids if str(x).strip()}
    kpi_list = [str(k) for k in body.kpi_fields]
    allowed_devices: set[uuid.UUID] | None = None
    if body.device_ids:
        allowed_devices = set(body.device_ids)
        if not allowed_devices:
            allowed_devices = None

    markers: list[dict[str, Any]]

    if mode == "single":
        if not body.single_source_type or not body.single_source_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "single mode requires single_source_type and single_source_id",
            )
        included = [
            {
                "source_type": str(body.single_source_type),
                "source_id": str(body.single_source_id),
            }
        ]
        markers = markers_manual_sources(
            db,
            customer_id=user.customer_id,
            site_id=body.site_id,
            included=included,
            lat_field=body.latitude_field,
            lon_field=body.longitude_field,
            kpi_fields=kpi_list,
            title_field=body.title_field,
            health_field=body.health_field,
            pg_single_marker_fn=build_map_marker_for_source,
        )
    elif mode == "manual":
        raw = body.included_sources or []
        if not raw:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "manual mode requires included_sources")
        markers = markers_manual_sources(
            db,
            customer_id=user.customer_id,
            site_id=body.site_id,
            included=list(raw),
            lat_field=body.latitude_field,
            lon_field=body.longitude_field,
            kpi_fields=kpi_list,
            title_field=body.title_field,
            health_field=body.health_field,
            pg_single_marker_fn=build_map_marker_for_source,
        )
    else:
        markers = markers_with_redis_first(
            db,
            customer_id=user.customer_id,
            site_id=body.site_id,
            lat_field=body.latitude_field,
            lon_field=body.longitude_field,
            kpi_fields=kpi_list,
            excluded=excluded,
            title_field=body.title_field,
            health_field=body.health_field,
            allowed_device_ids=allowed_devices,
            pg_markers_fn=_map_markers_site,
        )
        markers = merge_latest_device_state_map_markers(
            markers,
            db,
            customer_id=user.customer_id,
            site_id=body.site_id,
            latf=body.latitude_field,
            lonf=body.longitude_field,
            kpi_fields=kpi_list,
            excluded=excluded,
            title_field=body.title_field,
            health_field=body.health_field,
        )

    if mode != "single" and body.aggregate_by_device:
        markers = aggregate_data_object_markers_by_device(markers)

    if body.light:
        markers = [map_marker_to_light(m) for m in markers]

    mi = compute_map_init_from_markers(markers) if markers else None
    return MapMarkersQueryResponse(markers=markers, map_init=mi)


@router.get("/detail", response_model=MapDetailResponse)
def map_object_detail(
    site_id: uuid.UUID = Query(...),
    source_type: str = Query(...),
    source_id: uuid.UUID = Query(...),
    display_field_paths: list[str] | None = Query(None, alias="displayFieldPaths"),
    kpi_keys: list[str] | None = Query(None, alias="kpiKeys"),
    trend_scope: str | None = Query(
        None,
        alias="trendScope",
        description="For latest_device_state: trend_context scope (resolved_device|endpoint|site). Default resolved_device.",
        pattern="^(resolved_device|endpoint|site)$",
    ),
    include_timescale_history: bool = Query(
        False,
        alias="includeTimescaleHistory",
        description="When true, load Timescale KPI samples (slower). Default false for fast popups.",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stn = source_type.strip().lower()
    if stn not in ("data_object", "result_object", "latest_device_state", "device_state"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "source_type must be data_object, result_object, latest_device_state, or device_state",
        )
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    detail = map_marker_detail(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        source_type=source_type,
        source_id=source_id,
        display_field_paths=display_field_paths,
        kpi_keys=kpi_keys,
        trend_scope=trend_scope,
        include_timescale_history=include_timescale_history,
    )
    if not detail:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Object not found")
    return MapDetailResponse(detail=detail)


@router.get("/intelligence/expanded")
def map_intelligence_expanded(
    site_id: uuid.UUID = Query(...),
    endpoint_id: uuid.UUID | None = Query(None),
    mode: str = Query("runtime", pattern="^(runtime|historical)$"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    kpi_keys: list[str] | None = Query(None, alias="kpiKeys"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Endpoint/site device roster with mobility + server-side freshness (Phases 2–3)."""
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    if endpoint_id is not None:
        ep = db.get(Endpoint, endpoint_id)
        if not ep or ep.site_id != site_id or ep.customer_id != user.customer_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    keys = list(kpi_keys or [])
    body = build_expanded_intelligence(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        endpoint_id=endpoint_id,
        mode=mode,
        page=page,
        limit=limit,
        kpi_keys=keys,
    )
    if endpoint_id is not None and body.get("endpoint") is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    return body


@router.get("/intelligence/path")
def map_intelligence_path(
    site_id: uuid.UUID = Query(...),
    entity_id: uuid.UUID = Query(..., alias="entityId"),
    scope: str = Query("resolved_device", pattern="^resolved_device$"),
    from_ts: datetime | None = Query(None, alias="from"),
    to_ts: datetime | None = Query(None, alias="to"),
    expected_frequency_sec: int = Query(15, ge=5, le=3600),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Historical footprint from scrubbed_events (Phase 4–5: polyline, gaps, stale segments)."""
    if scope != "resolved_device":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only scope=resolved_device is supported")
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    rd = db.get(ResolvedDevice, entity_id)
    if not rd or rd.site_id != site_id or rd.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resolved device not found")
    path = build_device_path(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        resolved_device_id=entity_id,
        from_ts=from_ts,
        to_ts=to_ts,
        expected_frequency_sec=expected_frequency_sec,
    )
    return path


@router.get("/intelligence/historical-markers")
def map_intelligence_historical_markers(
    site_id: uuid.UUID = Query(...),
    endpoint_id: uuid.UUID | None = Query(None),
    from_ts: datetime | None = Query(None, alias="from"),
    to_ts: datetime | None = Query(None, alias="to"),
    max_points: int = Query(400, ge=50, le=2000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Deduped scrubbed-event coordinates for historical map overlay (all devices in scope)."""
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    if endpoint_id is not None:
        ep = db.get(Endpoint, endpoint_id)
        if not ep or ep.site_id != site_id or ep.customer_id != user.customer_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    body = build_site_historical_sample_points(
        db,
        customer_id=user.customer_id,
        site_id=site_id,
        endpoint_id=endpoint_id,
        from_ts=from_ts,
        to_ts=to_ts,
        max_points=max_points,
    )
    return body


@router.get("/internal/aggregator", include_in_schema=False)
def map_aggregator_internal(_user: User = Depends(get_current_user)):
    """Process visibility for map object-state aggregator (Redis stats)."""
    return internal_aggregator_visibility()
