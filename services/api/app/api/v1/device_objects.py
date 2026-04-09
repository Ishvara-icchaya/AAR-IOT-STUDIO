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
    row.mapping = merge_device_object_mapping(existing, body.mapping)
    db.add(row)
    db.commit()
    db.refresh(row)
    return DeviceObjectRead.model_validate(row)
