import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.api.deps import get_current_user
from app.api.v1.devices import _load_device
from app.db.session import get_db
from app.models.device_object import DeviceObject
from app.models.user import User
from app.schemas.device_object import (
    DeviceObjectPatch,
    DeviceObjectRead,
    merge_device_object_mapping,
)
from app.services.endpoint_scrubber_semantics_identity_sync import sync_v2_endpoint_identity_from_device_mapping
from app.services.field_catalog_service import validate_field_catalog

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("", response_model=DeviceObjectRead)
def get_device_object(
    device_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("device_objects.get device_id=%s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    row = db.execute(
        select(DeviceObject).where(DeviceObject.device_id == device_id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_object missing")
    return DeviceObjectRead.model_validate(row)


@router.patch("", response_model=DeviceObjectRead)
def patch_device_object(
    body: DeviceObjectPatch,
    device_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("device_objects.patch device_id=%s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    row = db.execute(
        select(DeviceObject).where(DeviceObject.device_id == device_id)
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device_object missing")

    existing = row.mapping if isinstance(row.mapping, dict) else {}
    patch_mapping = body.mapping if isinstance(body.mapping, dict) else {}
    patch_ss = patch_mapping.get("scrubberStudio") if isinstance(patch_mapping, dict) else None
    freeze_publish = isinstance(patch_ss, dict) and patch_ss.get("published") is True
    row.mapping = merge_device_object_mapping(existing, body.mapping)
    fc = row.mapping.get("fieldCatalog") if isinstance(row.mapping, dict) else None
    if isinstance(fc, dict):
        errs, warns = validate_field_catalog(fc)
        for w in warns:
            log.warning("device_objects.fieldCatalog device_id=%s %s", device_id, w)
        if errs:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(errs))
    db.add(row)
    if freeze_publish and isinstance(row.mapping, dict):
        sync_v2_endpoint_identity_from_device_mapping(
            db,
            device_id=device_id,
            merged_mapping=row.mapping,
            device_customer_id=device.customer_id,
        )
    db.commit()
    db.refresh(row)
    return DeviceObjectRead.model_validate(row)
