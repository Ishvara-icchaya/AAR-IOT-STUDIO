"""V2 ingest endpoints — CRUD and bounded lists (resolved devices, LDS, scrubbed history)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.endpoint import Endpoint
from app.models.latest_device_state import LatestDeviceState
from app.models.resolved_device import ResolvedDevice
from app.models.scrubbed_event import ScrubbedEvent
from app.models.user import User
from app.schemas.payload_field_metadata import PayloadFieldEntry, PayloadFieldMetadataResponse
from app.services.endpoint_identity_publish import merge_identity_draft, publish_endpoint_identity, sample_document_for_validation
from app.services.endpoint_sample_service import normalize_sample_document
from app.services.payload_field_catalog import build_payload_field_entries
from app.schemas.endpoint import (
    MapMarkerListResponse,
    MapMarkerRead,
    EndpointCreate,
    EndpointListResponse,
    EndpointRead,
    EndpointUpdate,
    LatestDeviceStateListResponse,
    LatestDeviceStateRead,
    ResolvedDeviceListResponse,
    ResolvedDeviceRead,
    ScrubbedEventListResponse,
    ScrubbedEventRead,
)

router = APIRouter()
log = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _load_endpoint(db: Session, endpoint_id: uuid.UUID, customer_id: uuid.UUID) -> Endpoint | None:
    return db.execute(
        select(Endpoint).where(Endpoint.id == endpoint_id, Endpoint.customer_id == customer_id)
    ).scalar_one_or_none()


def _ensure_endpoint_visible(ep: Endpoint, user: User, allowed: list[uuid.UUID] | None) -> None:
    if not user_may_access_site(user, ep.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted for this user")


def _normalize_key_list(raw: list[Any]) -> list[str]:
    return [str(x).strip() for x in raw if str(x).strip()]


@router.get("", response_model=EndpointListResponse)
def list_endpoints(
    site_id: uuid.UUID | None = Query(None),
    q: str | None = Query(None, description="Substring match on endpoint_name (case-insensitive)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and len(allowed) == 0:
        return EndpointListResponse(items=[])

    stmt = select(Endpoint).where(Endpoint.customer_id == user.customer_id).order_by(Endpoint.endpoint_name)
    if allowed is not None:
        stmt = stmt.where(Endpoint.site_id.in_(allowed))
    if site_id is not None:
        if allowed is not None and site_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
        stmt = stmt.where(Endpoint.site_id == site_id)
    if q and (qs := q.strip()):
        stmt = stmt.where(Endpoint.endpoint_name.ilike(f"%{qs}%"))

    rows = db.scalars(stmt).all()
    return EndpointListResponse(items=[EndpointRead.model_validate(r) for r in rows])


@router.post("", response_model=EndpointRead, status_code=status.HTTP_201_CREATED)
def create_endpoint(
    body: EndpointCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site for this tenant")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot create endpoint for this site")

    draft: dict[str, Any] = {}
    if body.primary_device_key_fields is not None:
        pk_pre = _normalize_key_list(body.primary_device_key_fields)
        if pk_pre:
            draft["primary_device_key_fields"] = pk_pre
    if body.device_label_fields is not None:
        dl = _normalize_key_list(body.device_label_fields)
        if dl:
            draft["device_label_fields"] = dl
    if body.location_fields is not None:
        draft["location_fields"] = body.location_fields
    ep = Endpoint(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        site_id=body.site_id,
        endpoint_name=body.endpoint_name.strip(),
        protocol=body.protocol.strip().lower()[:32],
        object_name=body.object_name.strip(),
        lifecycle_status="draft",
        primary_device_key_fields=None,
        device_label_fields=None,
        location_fields=None,
        identity_draft=draft or None,
        auth_config=body.auth_config,
        device_endpoint_id=body.device_endpoint_id,
        enabled=body.enabled,
    )
    db.add(ep)
    db.commit()
    db.refresh(ep)
    log.debug("endpoints.create id=%s site_id=%s object_name=%s", ep.id, ep.site_id, ep.object_name)
    return EndpointRead.model_validate(ep)


@router.get("/{endpoint_id}", response_model=EndpointRead)
def get_endpoint(
    endpoint_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)
    return EndpointRead.model_validate(ep)


@router.get(
    "/{endpoint_id}/sample-field-metadata",
    response_model=PayloadFieldMetadataResponse,
)
def get_endpoint_sample_field_metadata(
    endpoint_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)
    doc = sample_document_for_validation(ep)
    raw = build_payload_field_entries(doc)
    return PayloadFieldMetadataResponse(items=[PayloadFieldEntry.model_validate(x) for x in raw])


@router.post("/{endpoint_id}/publish-identity", response_model=EndpointRead)
def post_publish_endpoint_identity(
    endpoint_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)
    ep = publish_endpoint_identity(db, ep)
    return EndpointRead.model_validate(ep)


@router.patch("/{endpoint_id}", response_model=EndpointRead)
def update_endpoint(
    endpoint_id: uuid.UUID,
    body: EndpointUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    data = body.model_dump(exclude_unset=True)
    draft = dict(ep.identity_draft or {})
    if "primary_device_key_fields" in data:
        raw_pk = data.pop("primary_device_key_fields")
        if raw_pk is None:
            draft.pop("primary_device_key_fields", None)
        else:
            pk_fields = _normalize_key_list(raw_pk)
            if pk_fields:
                draft["primary_device_key_fields"] = pk_fields
            else:
                draft.pop("primary_device_key_fields", None)
    if "device_label_fields" in data:
        raw = data.pop("device_label_fields")
        if raw is None:
            draft.pop("device_label_fields", None)
        else:
            dl = _normalize_key_list(raw) if raw else []
            if dl:
                draft["device_label_fields"] = dl
            else:
                draft.pop("device_label_fields", None)
    if "location_fields" in data:
        lf = data.pop("location_fields")
        if lf is None:
            draft.pop("location_fields", None)
        else:
            draft["location_fields"] = lf
    if "identity_draft" in data and data["identity_draft"] is not None:
        patch = data.pop("identity_draft")
        if isinstance(patch, dict):
            draft = merge_identity_draft(draft, patch)
    ep.identity_draft = draft or None
    if ep.identity_published_at is None and ep.lifecycle_status not in ("error", "disabled"):
        if ep.sample_payload is not None and (ep.identity_draft or {}):
            ep.lifecycle_status = "needs_identity_mapping"
    if "endpoint_name" in data and data["endpoint_name"] is not None:
        ep.endpoint_name = data["endpoint_name"].strip()
    if "protocol" in data and data["protocol"] is not None:
        ep.protocol = data["protocol"].strip().lower()[:32]
    if "object_name" in data and data["object_name"] is not None:
        ep.object_name = data["object_name"].strip()
    if "auth_config" in data:
        ep.auth_config = data["auth_config"]
    if "device_endpoint_id" in data:
        ep.device_endpoint_id = data["device_endpoint_id"]
    if "enabled" in data and data["enabled"] is not None:
        ep.enabled = data["enabled"]

    ep.updated_at = _utcnow()
    db.add(ep)
    db.commit()
    db.refresh(ep)
    return EndpointRead.model_validate(ep)


@router.get("/{endpoint_id}/resolved-devices", response_model=ResolvedDeviceListResponse)
def list_resolved_devices(
    endpoint_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    stmt = (
        select(ResolvedDevice)
        .where(ResolvedDevice.endpoint_id == endpoint_id)
        .order_by(ResolvedDevice.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.scalars(stmt).all()
    return ResolvedDeviceListResponse(items=[ResolvedDeviceRead.model_validate(r) for r in rows])


@router.get("/{endpoint_id}/latest-device-states", response_model=LatestDeviceStateListResponse)
def list_latest_device_states(
    endpoint_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    stmt = (
        select(LatestDeviceState)
        .where(LatestDeviceState.endpoint_id == endpoint_id)
        .order_by(LatestDeviceState.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    rows = db.scalars(stmt).all()
    return LatestDeviceStateListResponse(items=[LatestDeviceStateRead.model_validate(r) for r in rows])


@router.get("/{endpoint_id}/scrubbed-events", response_model=ScrubbedEventListResponse)
def list_scrubbed_events(
    endpoint_id: uuid.UUID,
    limit: int = Query(5, ge=1, le=200),
    cursor: str | None = Query(
        None,
        description="Pagination: scrubbed_events.id from the previous page (older events).",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    stmt = (
        select(ScrubbedEvent)
        .where(ScrubbedEvent.endpoint_id == endpoint_id)
        .where(ScrubbedEvent.customer_id == user.customer_id)
        .order_by(ScrubbedEvent.event_ts.desc(), ScrubbedEvent.id.desc())
    )

    if cursor and (c := cursor.strip()):
        try:
            cid = uuid.UUID(c)
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid pagination token UUID") from e
        brow = db.get(ScrubbedEvent, cid)
        if (
            not brow
            or brow.endpoint_id != endpoint_id
            or brow.customer_id != user.customer_id
        ):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pagination token does not match this endpoint")
        stmt = stmt.where(
            or_(
                ScrubbedEvent.event_ts < brow.event_ts,
                and_(ScrubbedEvent.event_ts == brow.event_ts, ScrubbedEvent.id < brow.id),
            )
        )

    stmt = stmt.limit(limit + 1)
    rows = list(db.scalars(stmt).all())
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor: str | None = str(page[-1].id) if has_more and page else None

    return ScrubbedEventListResponse(
        items=[ScrubbedEventRead.model_validate(r) for r in page],
        next_cursor=next_cursor,
    )


@router.get(
    "/{endpoint_id}/resolved-devices/{resolved_device_id}/latest-device-state",
    response_model=LatestDeviceStateRead,
)
def get_latest_state_for_resolved_device(
    endpoint_id: uuid.UUID,
    resolved_device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    row = db.execute(
        select(LatestDeviceState).where(
            LatestDeviceState.endpoint_id == endpoint_id,
            LatestDeviceState.resolved_device_id == resolved_device_id,
            LatestDeviceState.customer_id == user.customer_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "latest_device_state not found")
    return LatestDeviceStateRead.model_validate(row)


@router.get("/{endpoint_id}/map-markers", response_model=MapMarkerListResponse)
def list_endpoint_map_markers(
    endpoint_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    rows = db.scalars(
        select(LatestDeviceState)
        .where(
            LatestDeviceState.endpoint_id == endpoint_id,
            LatestDeviceState.customer_id == user.customer_id,
        )
        .order_by(LatestDeviceState.updated_at.desc())
    ).all()

    markers: list[MapMarkerRead] = []
    for row in rows:
        loc = row.location_json if isinstance(row.location_json, dict) else {}
        lat = loc.get("lat", loc.get("latitude"))
        lon = loc.get("lon", loc.get("longitude"))
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            continue
        heading: float | None = None
        h = loc.get("heading")
        if h is not None:
            try:
                heading = float(h)
            except (TypeError, ValueError):
                heading = None
        markers.append(
            MapMarkerRead(
                resolved_device_id=row.resolved_device_id,
                latest_device_state_id=row.id,
                object_name=row.object_name,
                latitude=lat_f,
                longitude=lon_f,
                heading=heading,
                updated_at=row.updated_at,
                identity_json=row.identity_json if isinstance(row.identity_json, dict) else {},
                display_json=row.display_json if isinstance(row.display_json, dict) else {},
                kpi_json=row.kpi_json if isinstance(row.kpi_json, dict) else {},
                health_json=row.health_json if isinstance(row.health_json, dict) else None,
            )
        )
    return MapMarkerListResponse(items=markers)


@router.get(
    "/field-metadata/latest-device-state/{latest_device_state_id}",
    response_model=PayloadFieldMetadataResponse,
)
def latest_device_state_field_metadata(
    latest_device_state_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(LatestDeviceState, latest_device_state_id)
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "latest_device_state not found")
    allowed = allowed_site_ids_for_user(db, user)
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted for this user")
    payload = {
        "identity": row.identity_json if isinstance(row.identity_json, dict) else {},
        "display": row.display_json if isinstance(row.display_json, dict) else {},
        "kpi": row.kpi_json if isinstance(row.kpi_json, dict) else {},
        "health": row.health_json if isinstance(row.health_json, dict) else {},
        "location": row.location_json if isinstance(row.location_json, dict) else {},
    }
    raw = build_payload_field_entries(payload)
    return PayloadFieldMetadataResponse(items=[PayloadFieldEntry.model_validate(x) for x in raw])
