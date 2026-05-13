"""Device version lifecycle: promote / isolate / rollback (Phase 6)."""

import logging
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.device import DeviceVersionRead
from app.services.device_version_lifecycle_service import (
    deprecate_device_version,
    isolate_device_version,
    promote_device_version,
    rollback_device_version,
)

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{device_version_id}/promote", response_model=DeviceVersionRead)
def promote_device_version_endpoint(
    device_version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dv = promote_device_version(db, user, device_version_id)
    db.commit()
    return DeviceVersionRead.model_validate(dv)


@router.post("/{device_version_id}/isolate", response_model=DeviceVersionRead)
def isolate_device_version_endpoint(
    device_version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dv = isolate_device_version(db, user, device_version_id)
    db.commit()
    return DeviceVersionRead.model_validate(dv)


@router.post("/{device_version_id}/rollback", response_model=DeviceVersionRead)
def rollback_device_version_endpoint(
    device_version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    active_row = rollback_device_version(db, user, device_version_id)
    db.commit()
    return DeviceVersionRead.model_validate(active_row)


@router.post("/{device_version_id}/deprecate", response_model=DeviceVersionRead)
def deprecate_device_version_endpoint(
    device_version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dv = deprecate_device_version(db, user, device_version_id)
    db.commit()
    return DeviceVersionRead.model_validate(dv)
