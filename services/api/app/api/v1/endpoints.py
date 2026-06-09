"""V2 ingest endpoints — CRUD and bounded lists (resolved devices, LDS, scrubbed history)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.access_control import ensure_site_in_tenant, user_may_access_site
from app.services.permission_service import site_ids_with_permission
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.device_version import DeviceVersion
from app.models.device_endpoint import DeviceEndpoint
from app.models.device_object import DeviceObject
from app.models.endpoint import Endpoint
from app.models.latest_device_state import LatestDeviceState
from app.models.resolved_device import ResolvedDevice
from app.models.scrubbed_event import ScrubbedEvent
from app.models.user import User
from app.schemas.payload_field_metadata import PayloadFieldEntry, PayloadFieldMetadataResponse
from app.services.device_version_read_context import (
    LiveReadLane,
    batch_effective_shared_device_version_ids,
    candidate_latest_row,
    device_id_for_resolved_device,
    resolve_operational_read_for_resolved_device,
)
from app.services.endpoint_scrubber_identity_hints import paths_from_device_mapping
from app.services.endpoint_scrubber_semantics_identity_sync import sync_v2_endpoint_identity_from_device_mapping
from app.services.endpoint_sample_service import normalize_sample_document
from app.services.functional_audit_alert import emit_functional_audit_alert
from app.services.payload_field_catalog import build_payload_field_entries
from app.schemas.endpoint import (
    MapMarkerListResponse,
    MapMarkerRead,
    EndpointCreate,
    EndpointListResponse,
    EndpointRead,
    EndpointUpdate,
    ScrubberIdentityHintsResponse,
    LatestDeviceStateListResponse,
    LatestDeviceStateRead,
    ResolvedDeviceListResponse,
    ResolvedDeviceRead,
    ScrubbedEventListResponse,
    ScrubbedEventRead,
)

router = APIRouter()
log = logging.getLogger(__name__)


def _linked_device_id_for_endpoint(db: Session, ep: Endpoint) -> uuid.UUID | None:
    if not ep.device_endpoint_id:
        return None
    de = db.get(DeviceEndpoint, ep.device_endpoint_id)
    return de.device_id if de else None


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
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
    ep_id = uuid.uuid4()
    object_name = f"stream_{ep_id.hex}"
    ep = Endpoint(
        id=ep_id,
        customer_id=user.customer_id,
        site_id=body.site_id,
        endpoint_name=body.endpoint_name.strip(),
        protocol=body.protocol.strip().lower()[:32],
        object_name=object_name,
        lifecycle_status="draft",
        primary_device_key_fields=None,
        device_label_fields=None,
        location_fields=None,
        identity_draft=draft or None,
        auth_config=body.auth_config,
        device_endpoint_id=body.device_endpoint_id,
        enabled=body.enabled,
        version_identity=body.version_identity,
    )
    db.add(ep)
    db.flush()
    if body.device_endpoint_id is not None:
        de_row = db.get(DeviceEndpoint, body.device_endpoint_id)
        if de_row:
            do = db.execute(
                select(DeviceObject).where(DeviceObject.device_id == de_row.device_id).limit(1)
            ).scalar_one_or_none()
            m = dict(do.mapping) if do and isinstance(do.mapping, dict) else {}
            sync_v2_endpoint_identity_from_device_mapping(
                db,
                device_id=de_row.device_id,
                merged_mapping=m,
                device_customer_id=user.customer_id,
            )
    db.commit()
    db.refresh(ep)
    log.debug("endpoints.create id=%s site_id=%s object_name=%s", ep.id, ep.site_id, ep.object_name)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="created",
        resource_type="Ingest endpoint",
        resource_label=ep.endpoint_name,
        site_id=ep.site_id,
        device_id=_linked_device_id_for_endpoint(db, ep),
        resource_created_at=ep.created_at,
        resource_updated_at=ep.updated_at,
        source_object_type="endpoint",
        source_object_id=ep.id,
    )
    return EndpointRead.model_validate(ep)


@router.get("/{endpoint_id}", response_model=EndpointRead)
def get_endpoint(
    endpoint_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "endpoints.read")
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)
    return EndpointRead.model_validate(ep)


@router.get(
    "/{endpoint_id}/scrubber-identity-hints",
    response_model=ScrubberIdentityHintsResponse,
)
def get_endpoint_scrubber_identity_hints(
    endpoint_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Primary key / label JSON paths implied by Scrubber Studio semantics on the linked device."""
    allowed = site_ids_with_permission(db, user, "endpoints.read")
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)
    if ep.device_endpoint_id is None:
        return ScrubberIdentityHintsResponse(primary_device_key_fields=[], device_label_fields=[])
    de = db.get(DeviceEndpoint, ep.device_endpoint_id)
    if not de:
        return ScrubberIdentityHintsResponse(primary_device_key_fields=[], device_label_fields=[])
    dev = db.get(Device, de.device_id)
    if not dev or dev.customer_id != user.customer_id:
        return ScrubberIdentityHintsResponse(primary_device_key_fields=[], device_label_fields=[])
    do = db.execute(
        select(DeviceObject).where(DeviceObject.device_id == de.device_id).limit(1)
    ).scalar_one_or_none()
    mapping = do.mapping if do and isinstance(do.mapping, dict) else None
    pk, labels = paths_from_device_mapping(mapping)
    return ScrubberIdentityHintsResponse(primary_device_key_fields=pk, device_label_fields=labels)


@router.get(
    "/{endpoint_id}/sample-field-metadata",
    response_model=PayloadFieldMetadataResponse,
)
def get_endpoint_sample_field_metadata(
    endpoint_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
    allowed = site_ids_with_permission(db, user, "endpoints.read")
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)
    ep = publish_endpoint_identity(db, ep)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="updated",
        resource_type="Ingest endpoint",
        resource_label=f"{ep.endpoint_name} (identity published)",
        site_id=ep.site_id,
        device_id=_linked_device_id_for_endpoint(db, ep),
        resource_created_at=ep.created_at,
        resource_updated_at=ep.updated_at,
        source_object_type="endpoint",
        source_object_id=ep.id,
    )
    return EndpointRead.model_validate(ep)


@router.patch("/{endpoint_id}", response_model=EndpointRead)
def update_endpoint(
    endpoint_id: uuid.UUID,
    body: EndpointUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "endpoints.read")
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    patch_keys = set(body.model_dump(exclude_unset=True).keys())
    if ep.identity_managed_by_scrubber and patch_keys.intersection(
        {"primary_device_key_fields", "device_label_fields", "location_fields", "identity_draft"}
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=(
                "Identity paths are managed by the published scrubber pipeline (Field Explorer identity/display roles). "
                "Update the scrubber and republish, or use Ingest → View identity to inspect the applied sample."
            ),
        )

    data = body.model_dump(exclude_unset=True)
    if "object_name" in data:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "object_name is system-generated when the endpoint is created and cannot be changed.",
        )
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
    if "auth_config" in data:
        ep.auth_config = data["auth_config"]
    if "version_identity" in data:
        ep.version_identity = data.pop("version_identity")
    if "device_endpoint_id" in data:
        ep.device_endpoint_id = data["device_endpoint_id"]
    if "enabled" in data and data["enabled"] is not None:
        ep.enabled = data["enabled"]

    ep.updated_at = _utcnow()
    db.add(ep)
    if "device_endpoint_id" in data and ep.device_endpoint_id is not None:
        de_row = db.get(DeviceEndpoint, ep.device_endpoint_id)
        if de_row:
            do = db.execute(
                select(DeviceObject).where(DeviceObject.device_id == de_row.device_id).limit(1)
            ).scalar_one_or_none()
            m = dict(do.mapping) if do and isinstance(do.mapping, dict) else {}
            sync_v2_endpoint_identity_from_device_mapping(
                db,
                device_id=de_row.device_id,
                merged_mapping=m,
                device_customer_id=ep.customer_id,
            )
    db.commit()
    db.refresh(ep)
    emit_functional_audit_alert(
        db,
        customer_id=user.customer_id,
        actor=user,
        verb="updated",
        resource_type="Ingest endpoint",
        resource_label=ep.endpoint_name,
        site_id=ep.site_id,
        device_id=_linked_device_id_for_endpoint(db, ep),
        resource_created_at=ep.created_at,
        resource_updated_at=ep.updated_at,
        source_object_type="endpoint",
        source_object_id=ep.id,
    )
    return EndpointRead.model_validate(ep)


@router.get("/{endpoint_id}/resolved-devices", response_model=ResolvedDeviceListResponse)
def list_resolved_devices(
    endpoint_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
    device_version_id: uuid.UUID | None = Query(
        None,
        alias="deviceVersionId",
        description="Explicit operational cut (candidate lane overlays live fields).",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "endpoints.read")
    ep = _load_endpoint(db, endpoint_id, user.customer_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    _ensure_endpoint_visible(ep, user, allowed)

    rows = list(
        db.scalars(
            select(LatestDeviceState)
            .where(
                LatestDeviceState.endpoint_id == endpoint_id,
                LatestDeviceState.customer_id == user.customer_id,
            )
            .order_by(LatestDeviceState.updated_at.desc())
        ).all()
    )
    rids = [r.resolved_device_id for r in rows]
    eff_map = batch_effective_shared_device_version_ids(
        db, customer_id=user.customer_id, resolved_device_ids=rids
    )
    pin_dv = db.get(DeviceVersion, device_version_id) if device_version_id else None

    markers: list[MapMarkerRead] = []
    for row in rows:
        loc = row.location_json if isinstance(row.location_json, dict) else {}
        disp = row.display_json if isinstance(row.display_json, dict) else {}
        kpi = row.kpi_json if isinstance(row.kpi_json, dict) else {}
        hj = row.health_json if isinstance(row.health_json, dict) else None
        up_at = row.updated_at
        if pin_dv is not None:
            pid_dev = device_id_for_resolved_device(db, row.resolved_device_id)
            if pid_dev == pin_dv.device_id:
                try:
                    ctx = resolve_operational_read_for_resolved_device(
                        db,
                        customer_id=user.customer_id,
                        resolved_device_id=row.resolved_device_id,
                        explicit_device_version_id=pin_dv.id,
                    )
                except (LookupError, PermissionError):
                    ctx = None
                else:
                    if ctx.live_read_lane == LiveReadLane.unavailable:
                        continue
                    if ctx.live_read_lane == LiveReadLane.candidate_lds:
                        crow = candidate_latest_row(
                            db, resolved_device_id=row.resolved_device_id, device_version_id=pin_dv.id
                        )
                        if crow:
                            loc = crow.location_json if isinstance(crow.location_json, dict) else {}
                            disp = crow.display_json if isinstance(crow.display_json, dict) else {}
                            kpi = crow.kpi_json if isinstance(crow.kpi_json, dict) else {}
                            hj = crow.health_json if isinstance(crow.health_json, dict) else None
                            up_at = crow.updated_at
                        else:
                            continue
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
                updated_at=up_at,
                identity_json=row.identity_json if isinstance(row.identity_json, dict) else {},
                display_json=disp,
                kpi_json=kpi,
                health_json=hj,
                effective_device_version_id=eff_map.get(row.resolved_device_id),
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
    allowed = site_ids_with_permission(db, user, "endpoints.read")
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
