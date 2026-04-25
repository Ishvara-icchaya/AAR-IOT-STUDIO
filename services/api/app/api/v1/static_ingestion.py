"""CRUD and validation for static JSON ingestions (workflow Static nodes)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.device import Device
from app.models.static_ingestion import StaticIngestion
from app.models.user import User
from app.schemas.static_ingestion import (
    StaticIngestionCreate,
    StaticIngestionListItem,
    StaticIngestionListResponse,
    StaticIngestionRead,
    StaticIngestionUpdate,
    StaticIngestionValidateRequest,
    StaticIngestionValidateResponse,
)
from app.services.static_ingestion_validation import validate_payload_semantics, validate_schedule_semantics

router = APIRouter()
log = logging.getLogger(__name__)


def _collect_validation_errors(body: StaticIngestionValidateRequest) -> list[str]:
    errs: list[str] = []
    errs.extend(validate_schedule_semantics(body.schedule_json))
    errs.extend(validate_payload_semantics(body.payload_json))
    return errs


def _accessible_device(db: Session, user: User, device_id: uuid.UUID) -> Device | None:
    allowed = allowed_site_ids_for_user(db, user)
    stmt = select(Device).where(Device.id == device_id, Device.customer_id == user.customer_id)
    dev = db.execute(stmt).scalar_one_or_none()
    if not dev:
        return None
    if not user_may_access_site(user, dev.site_id, allowed):
        return None
    return dev


def _ensure_row_access(db: Session, user: User, row: StaticIngestion | None) -> StaticIngestion:
    if not row or row.customer_id != user.customer_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Static ingestion not found")
    allowed = allowed_site_ids_for_user(db, user)
    if not user_may_access_site(user, row.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    return row


def _validate_device_scope(
    db: Session, user: User, body: StaticIngestionValidateRequest
) -> Device | None:
    """If body.device_id is set, ensure device exists, is accessible, and matches site_id."""
    if body.device_id is None:
        return None
    dev = _accessible_device(db, user, body.device_id)
    if not dev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if dev.site_id != body.site_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="site_id must match the device's site when device_id is set",
        )
    return dev


@router.post("/validate", response_model=StaticIngestionValidateResponse)
def validate_static_ingestion(
    body: StaticIngestionValidateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    _validate_device_scope(db, user, body)

    errs = _collect_validation_errors(body)
    return StaticIngestionValidateResponse(valid=len(errs) == 0, errors=errs)


@router.get("", response_model=StaticIngestionListResponse)
def list_static_ingestions(
    site_id: uuid.UUID | None = Query(None),
    device_id: uuid.UUID | None = Query(None),
    q: str | None = None,
    active_only: bool = Query(False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if (site_id is None) == (device_id is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide exactly one of site_id or device_id",
        )

    allowed = allowed_site_ids_for_user(db, user)

    if device_id is not None:
        dev = _accessible_device(db, user, device_id)
        if not dev:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
        stmt = (
            select(StaticIngestion)
            .where(
                StaticIngestion.customer_id == user.customer_id,
                StaticIngestion.device_id == device_id,
            )
            .order_by(StaticIngestion.name.asc())
        )
    else:
        assert site_id is not None
        site = ensure_site_in_tenant(db, user.customer_id, site_id)
        if not site:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
        if not user_may_access_site(user, site_id, allowed):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
        stmt = (
            select(StaticIngestion)
            .where(
                StaticIngestion.customer_id == user.customer_id,
                StaticIngestion.site_id == site_id,
            )
            .order_by(StaticIngestion.name.asc())
        )

    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(StaticIngestion.name.ilike(pat), StaticIngestion.description.ilike(pat))
        )
    if active_only:
        now = datetime.now(timezone.utc)
        stmt = stmt.where(or_(StaticIngestion.end_at.is_(None), StaticIngestion.end_at > now))

    rows = list(db.scalars(stmt).all())
    return StaticIngestionListResponse(items=[StaticIngestionListItem.model_validate(r) for r in rows])


@router.post("", response_model=StaticIngestionRead, status_code=status.HTTP_201_CREATED)
def create_static_ingestion(
    body: StaticIngestionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    _validate_device_scope(db, user, body)

    errs = _collect_validation_errors(body)
    if errs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"message": "validation failed", "errors": errs},
        )

    row = StaticIngestion(
        customer_id=user.customer_id,
        site_id=body.site_id,
        device_id=body.device_id,
        name=body.name.strip(),
        description=(body.description.strip() if body.description else None) or None,
        end_at=body.end_at,
        schedule_json=dict(body.schedule_json or {}),
        payload_json=dict(body.payload_json or {}),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        msg = (
            "A static ingestion with this name already exists for this device"
            if body.device_id
            else "A static ingestion with this name already exists for this site"
        )
        raise HTTPException(status.HTTP_409_CONFLICT, detail=msg) from None
    db.refresh(row)
    log.debug("static_ingestion created id=%s", row.id)
    return StaticIngestionRead.model_validate(row)


@router.get("/{static_ingestion_id}", response_model=StaticIngestionRead)
def get_static_ingestion(
    static_ingestion_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(StaticIngestion, static_ingestion_id)
    row = _ensure_row_access(db, user, row)
    return StaticIngestionRead.model_validate(row)


@router.put("/{static_ingestion_id}", response_model=StaticIngestionRead)
def update_static_ingestion(
    static_ingestion_id: uuid.UUID,
    body: StaticIngestionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(StaticIngestion, static_ingestion_id)
    row = _ensure_row_access(db, user, row)

    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and patch["name"] is not None:
        row.name = str(patch["name"]).strip()
    if "description" in patch:
        d = patch.get("description")
        row.description = (str(d).strip() if d else None) or None
    if "end_at" in patch:
        row.end_at = patch.get("end_at")
    if "schedule_json" in patch and patch.get("schedule_json") is not None:
        row.schedule_json = dict(patch["schedule_json"])
    if "payload_json" in patch and patch.get("payload_json") is not None:
        row.payload_json = dict(patch["payload_json"])

    fake = StaticIngestionValidateRequest(
        site_id=row.site_id,
        device_id=row.device_id,
        name=row.name,
        description=row.description,
        end_at=row.end_at,
        schedule_json=dict(row.schedule_json or {}),
        payload_json=dict(row.payload_json or {}),
    )
    errs = _collect_validation_errors(fake)
    if errs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"message": "validation failed", "errors": errs},
        )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        msg = (
            "A static ingestion with this name already exists for this device"
            if row.device_id
            else "A static ingestion with this name already exists for this site"
        )
        raise HTTPException(status.HTTP_409_CONFLICT, detail=msg) from None
    db.refresh(row)
    return StaticIngestionRead.model_validate(row)


@router.delete("/{static_ingestion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_static_ingestion(
    static_ingestion_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(StaticIngestion, static_ingestion_id)
    row = _ensure_row_access(db, user, row)
    db.delete(row)
    db.commit()
    return None
