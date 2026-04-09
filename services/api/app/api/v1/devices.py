import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, exists
from sqlalchemy.orm import Session, joinedload

from app.access_control import allowed_site_ids_for_user, ensure_site_in_tenant, user_may_access_site
from app.api.deps import get_current_user
from app.core.endpoint_activation import ACTIVATION_STATUS_DESCRIPTION, is_valid_activation_status
from app.core.pipeline_log import emit as pipeline_emit
from app.db.session import get_db
from app.models.device import Device
from app.models.device_endpoint import DeviceEndpoint
from app.models.device_object import DeviceObject
from app.models.raw_data_object import RawDataObject
from app.models.user import User
from app.schemas.device import (
    DeviceCreate,
    DeviceDeleteFrozenDashboardRef,
    DeviceDeleteResponse,
    DeviceListResponse,
    DeviceRead,
    DeviceUpdate,
)
from app.services.alert_emit import emit_alert
from app.services.dashboard_dependency_service import check_device_in_use

router = APIRouter()
log = logging.getLogger(__name__)


def _load_device(db: Session, device_id: uuid.UUID, customer_id: uuid.UUID) -> Device | None:
    return db.execute(
        select(Device)
        .options(joinedload(Device.endpoint))
        .where(Device.id == device_id, Device.customer_id == customer_id)
    ).scalar_one_or_none()


def _ensure_device_visible(
    device: Device,
    user: User,
    allowed: list[uuid.UUID] | None,
) -> None:
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted for this user")


@router.get("", response_model=DeviceListResponse)
def list_devices(
    q: str | None = Query(None, description="Search by device name or description (substring, case-insensitive)"),
    site_id: uuid.UUID | None = Query(None),
    endpoint_activation_status: str | None = Query(
        None,
        description=f"Filter by saved endpoint activation_status. {ACTIVATION_STATUS_DESCRIPTION}.",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.list_devices")
    allowed = allowed_site_ids_for_user(db, user)
    if allowed is not None and len(allowed) == 0:
        return DeviceListResponse(items=[])

    stmt = (
        select(Device)
        .options(joinedload(Device.endpoint))
        .where(Device.customer_id == user.customer_id)
        .order_by(Device.name)
    )
    if allowed is not None:
        stmt = stmt.where(Device.site_id.in_(allowed))
    if site_id is not None:
        if allowed is not None and site_id not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
        stmt = stmt.where(Device.site_id == site_id)
    if q and (qs := q.strip()):
        qq = f"%{qs}%"
        stmt = stmt.where(or_(Device.name.ilike(qq), Device.description.ilike(qq)))
    if endpoint_activation_status and (eas := endpoint_activation_status.strip()):
        if not is_valid_activation_status(eas):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Invalid endpoint_activation_status. {ACTIVATION_STATUS_DESCRIPTION}.",
            )
        stmt = stmt.where(
            exists(
                select(DeviceEndpoint.id).where(
                    DeviceEndpoint.device_id == Device.id,
                    DeviceEndpoint.activation_status == eas,
                )
            )
        )

    rows = db.scalars(stmt).unique().all()
    return DeviceListResponse(items=[DeviceRead.model_validate(d) for d in rows])


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
def register_device(
    body: DeviceCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.register_device name=%r site_id=%s", body.name, body.site_id)
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site")
    if not user_may_access_site(user, body.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot assign device to this site")

    device = Device(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        site_id=body.site_id,
        name=body.name.strip(),
        description=body.description,
        icon=body.icon,
        is_active=True,
        polling_enabled=True,
    )
    db.add(device)
    db.flush()
    db.add(
        DeviceObject(
            id=uuid.uuid4(),
            device_id=device.id,
            customer_id=user.customer_id,
            mapping={},
        )
    )
    db.commit()
    d = _load_device(db, device.id, user.customer_id)
    assert d
    pipeline_emit(
        log,
        component="api.devices",
        action="register_device",
        status="ok",
        device_id=str(device.id),
        site_id=str(body.site_id),
        customer_id=str(user.customer_id),
    )
    return DeviceRead.model_validate(d)


@router.get("/{device_id}", response_model=DeviceRead)
def get_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.get_device %s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    return DeviceRead.model_validate(device)


@router.patch("/{device_id}", response_model=DeviceRead)
def update_device(
    device_id: uuid.UUID,
    body: DeviceUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.update_device %s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)
    was_active = device.is_active

    if body.site_id is not None:
        site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
        if not site:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown site")
        if not user_may_access_site(user, body.site_id, allowed):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot move device to this site")
        device.site_id = body.site_id

    if body.name is not None:
        device.name = body.name.strip()
    if body.description is not None:
        device.description = body.description
    if body.icon is not None:
        device.icon = body.icon
    if body.is_active is not None:
        device.is_active = body.is_active
    if body.polling_enabled is not None:
        device.polling_enabled = body.polling_enabled

    db.add(device)
    db.commit()
    d = _load_device(db, device_id, user.customer_id)
    assert d
    if body.is_active is False and was_active:
        try:
            emit_alert(
                db=db,
                category="device_health",
                severity="warning",
                title=f"Device marked inactive: {d.name}",
                message="Device is_active was set to false; telemetry may stop for this device.",
                customer_id=user.customer_id,
                site_id=d.site_id,
                device_id=d.id,
                source_component="api.devices",
                source_object_type="device",
                source_object_id=d.id,
                trace_id=None,
            )
        except Exception:
            log.debug("device inactive alert emit failed", exc_info=True)
    return DeviceRead.model_validate(d)


@router.delete("/{device_id}", response_model=DeviceDeleteResponse)
def delete_device(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("devices.delete_device %s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    _ensure_device_visible(device, user, allowed)

    cnt = db.scalar(
        select(func.count()).select_from(RawDataObject).where(RawDataObject.device_id == device_id)
    )
    if cnt and cnt > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Device has raw_data_objects; use inactive/stop instead of delete",
        )

    frozen_refs = check_device_in_use(db, customer_id=user.customer_id, device_id=device_id)
    n = len(frozen_refs)

    db.delete(device)
    db.commit()

    if n:
        pipeline_emit(
            log,
            component="api.devices",
            action="frozen_dashboard_refs_at_device_delete",
            status="warning",
            device_id=str(device_id),
            site_id=str(device.site_id),
            frozen_dashboard_count=n,
            frozen_dashboard_ids=",".join(str(d.id) for d in frozen_refs[:32]),
        )
    pipeline_emit(
        log,
        component="api.devices",
        action="deleted",
        status="ok",
        device_id=str(device_id),
        site_id=str(device.site_id),
        frozen_dashboard_count=n,
    )

    if not n:
        return DeviceDeleteResponse()

    return DeviceDeleteResponse(
        warning=(
            f"This device was still referenced by {n} frozen dashboard(s). "
            "Those widgets may show a degraded state until dashboards are edited or unfrozen."
        ),
        frozen_dashboard_count=n,
        frozen_dashboards=[
            DeviceDeleteFrozenDashboardRef(id=str(d.id), name=d.name) for d in frozen_refs
        ],
    )


@router.post("/{device_id}/polling/stop", response_model=DeviceRead)
def polling_stop(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return update_device(device_id, DeviceUpdate(polling_enabled=False), user, db)


@router.post("/{device_id}/polling/start", response_model=DeviceRead)
def polling_start(
    device_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return update_device(device_id, DeviceUpdate(polling_enabled=True), user, db)
