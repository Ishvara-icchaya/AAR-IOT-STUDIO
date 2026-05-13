"""Raw object list + MinIO verification."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from app.services.permission_service import site_ids_with_permission
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.device import Device
from app.models.raw_data_object import RawDataObject
from app.models.site import Site
from app.models.user import User
from app.schemas.raw_ingest_contract import RawObjectVerifyResponse
from app.schemas.raw_object_list import RawObjectListItem, RawObjectListResponse
from app.schemas.raw_preview import RawPreviewResponse
from app.services.raw_ingest_service import preview_raw_object, verify_raw_object

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=RawObjectListResponse)
def list_raw_objects(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    device_id: uuid.UUID | None = None,
    site_id: uuid.UUID | None = None,
    q: str | None = Query(None, description="Substring match on raw id, device name, or site name"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = site_ids_with_permission(db, user, "devices.read")
    if allowed is not None and len(allowed) == 0:
        return RawObjectListResponse(items=[], total=0)

    def _apply_filters(stmt):
        stmt = stmt.where(RawDataObject.customer_id == user.customer_id)
        if device_id is not None:
            stmt = stmt.where(RawDataObject.device_id == device_id)
        if site_id is not None:
            stmt = stmt.where(Device.site_id == site_id)
        if allowed is not None:
            stmt = stmt.where(Device.site_id.in_(allowed))
        if q and q.strip():
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    cast(RawDataObject.id, String).ilike(term),
                    Device.name.ilike(term),
                    Site.name.ilike(term),
                )
            )
        return stmt

    cnt_stmt = (
        select(func.count())
        .select_from(RawDataObject)
        .join(Device, Device.id == RawDataObject.device_id)
        .join(Site, Site.id == Device.site_id)
    )
    cnt_stmt = _apply_filters(cnt_stmt)
    total = db.scalar(cnt_stmt) or 0

    stmt = (
        select(RawDataObject, Device.name, Site.id, Site.name)
        .join(Device, Device.id == RawDataObject.device_id)
        .join(Site, Site.id == Device.site_id)
    )
    stmt = _apply_filters(stmt)
    stmt = stmt.order_by(
        RawDataObject.ingested_at.desc().nulls_last(),
        RawDataObject.id.desc(),
    ).limit(limit).offset(offset)

    items: list[RawObjectListItem] = []
    for raw, device_name, sid, site_name in db.execute(stmt).all():
        items.append(
            RawObjectListItem(
                id=raw.id,
                device_id=raw.device_id,
                device_name=device_name,
                site_id=sid,
                site_name=site_name,
                protocol_source=raw.protocol_source,
                captured_at=raw.captured_at,
                ingested_at=raw.ingested_at,
                size_bytes=raw.size_bytes,
                ingest_status=raw.ingest_status,
                verify_status=raw.verify_status,
                verified_at=raw.verified_at,
                checksum_sha256=raw.checksum,
                ingest_metadata=raw.ingest_metadata,
            )
        )

    log.debug(
        "raw_data_objects.list customer_id=%s device_id=%s total=%s returned=%s",
        user.customer_id,
        device_id,
        total,
        len(items),
    )
    return RawObjectListResponse(items=items, total=total)


@router.get("/{raw_id}/preview", response_model=RawPreviewResponse)
def get_raw_preview(
    raw_id: uuid.UUID,
    offset: int = Query(0, ge=0),
    max_bytes: int = Query(
        64 * 1024,
        ge=1,
        le=2 * 1024 * 1024,
        description="Capped server-side by RAW_PREVIEW_MAX_BYTES",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return preview_raw_object(
        db=db, user=user, raw_id=raw_id, offset=offset, max_bytes=max_bytes
    )


@router.get("/{raw_id}/verify", response_model=RawObjectVerifyResponse)
def get_raw_verify(
    raw_id: uuid.UUID,
    rehash: bool = Query(
        False,
        description="If true, download object from MinIO and verify SHA-256 (size ≤ RAW_INGEST_MAX_BYTES)",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return verify_raw_object(db=db, user=user, raw_id=raw_id, rehash=rehash)
