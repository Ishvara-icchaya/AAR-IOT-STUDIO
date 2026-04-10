"""Map runtime: eligible objects, marker detail (builder + live)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.dashboard_live import _map_markers_site
from app.services.map_runtime_service import (
    internal_aggregator_visibility,
    list_eligible_map_objects,
    map_marker_detail,
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
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Runtime markers for a site (Redis-first, same shape as dashboard map widget)."""
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    kpi_list = [x.strip() for x in kpi_fields.split(",") if x.strip()]
    excluded = {str(x).strip() for x in excluded_source_ids.split(",") if str(x).strip()}
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
        pg_markers_fn=_map_markers_site,
    )
    return MapMarkersResponse(markers=markers)


@router.get("/detail", response_model=MapDetailResponse)
def map_object_detail(
    site_id: uuid.UUID = Query(...),
    source_type: str = Query(...),
    source_id: uuid.UUID = Query(...),
    display_field_paths: list[str] | None = Query(None, alias="displayFieldPaths"),
    kpi_keys: list[str] | None = Query(None, alias="kpiKeys"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if source_type not in ("data_object", "result_object"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "source_type must be data_object or result_object")
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
    )
    if not detail:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Object not found")
    return MapDetailResponse(detail=detail)


@router.get("/internal/aggregator", include_in_schema=False)
def map_aggregator_internal(_user: User = Depends(get_current_user)):
    """Process visibility for map object-state aggregator (Redis stats)."""
    return internal_aggregator_visibility()
