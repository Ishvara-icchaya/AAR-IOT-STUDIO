"""Device version lifecycle: promote / isolate / rollback (Phase 6)."""

import logging
import uuid

from fastapi import APIRouter, Body, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.device import (
    DeviceVersionActivationAcceptRequest,
    DeviceVersionActivationCopyForwardRequest,
    DeviceVersionRead,
)
from app.services.device_version_activation_service import (
    accept_activation_artifacts,
    copy_forward_activation_artifacts,
)
from app.services.device_version_lifecycle_service import (
    deprecate_device_version,
    isolate_device_version,
    promote_device_version,
    rollback_device_version,
    submit_device_version_draft,
)

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{device_version_id}/copy-forward", response_model=DeviceVersionRead)
def copy_forward_activation_endpoint(
    device_version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    body: DeviceVersionActivationCopyForwardRequest | None = Body(default=None),
):
    """Stage endpoint / scrubber / workflow / dashboard snapshots onto a draft cut."""
    dv = copy_forward_activation_artifacts(
        db,
        user,
        device_version_id,
        from_device_version_id=(body.from_device_version_id if body else None),
    )
    db.commit()
    return DeviceVersionRead.model_validate(dv)


@router.post("/{device_version_id}/accept-activation", response_model=DeviceVersionRead)
def accept_activation_endpoint(
    device_version_id: uuid.UUID,
    body: DeviceVersionActivationAcceptRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark staged activation artifact groups accepted (required before promote when staged)."""
    dv = accept_activation_artifacts(db, user, device_version_id, kinds=body.kinds)
    db.commit()
    return DeviceVersionRead.model_validate(dv)


@router.post("/{device_version_id}/submit-draft", response_model=DeviceVersionRead)
def submit_device_version_draft_endpoint(
    device_version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """``detected`` → ``draft`` (endpoint version identity governance)."""
    dv = submit_device_version_draft(db, user, device_version_id)
    db.commit()
    return DeviceVersionRead.model_validate(dv)


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
