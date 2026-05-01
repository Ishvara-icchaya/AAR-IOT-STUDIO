import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.api.deps import get_current_user
from app.api.v1.devices import _load_device
from app.db.session import get_db
from app.models.device_endpoint import DeviceEndpoint
from app.models.user import User
from app.schemas.device_endpoint import (
    DeviceEndpointCreate,
    DeviceEndpointGetResponse,
    DeviceEndpointObservability,
    DeviceEndpointRead,
    DeviceEndpointUpdate,
    DeviceEndpointValidateRequest,
    DeviceEndpointValidateResponse,
)
from app.services.device_endpoint_lifecycle import (
    sync_activation_after_save,
    sync_activation_after_validation,
)
from app.services.device_endpoint_v2_mqtt_sync import push_mqtt_config_to_linked_v2_endpoint
from app.services.device_endpoint_observability import build_observability
from app.services.device_endpoint_validation import run_endpoint_validation, validation_timestamp

router = APIRouter()
log = logging.getLogger(__name__)


def _normalize_protocol_value(protocol: str) -> str:
    p = (protocol or "").strip().lower()
    if p == "socket":
        return "websocket"
    return (protocol or "").strip()


def _invalidate_validation(ep: DeviceEndpoint) -> None:
    ep.last_verified_at = None
    ep.validation_status = None
    ep.validation_detail = None


def _to_observability(db: Session, ep: DeviceEndpoint) -> DeviceEndpointObservability:
    try:
        poll_iv = int(ep.polling_interval_seconds)
    except (TypeError, ValueError):
        poll_iv = 60
    if poll_iv < 1:
        poll_iv = 60
    raw = build_observability(
        db,
        device_id=ep.device_id,
        protocol=ep.protocol,
        config=ep.config if isinstance(ep.config, dict) else {},
        polling_interval_seconds=poll_iv,
    )
    return DeviceEndpointObservability.model_validate(raw)


def _observability_for_validation(
    db: Session,
    ep: DeviceEndpoint,
    *,
    protocol: str,
    config: dict,
    polling_interval_seconds: int,
) -> DeviceEndpointObservability:
    raw = build_observability(
        db,
        device_id=ep.device_id,
        protocol=protocol,
        config=config if isinstance(config, dict) else {},
        polling_interval_seconds=polling_interval_seconds,
    )
    return DeviceEndpointObservability.model_validate(raw)


@router.get("", response_model=DeviceEndpointGetResponse)
def get_endpoint_for_device(
    device_id: uuid.UUID = Query(..., description="Device UUID"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("device_endpoints.get device_id=%s", device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    ep = db.execute(
        select(DeviceEndpoint).where(DeviceEndpoint.device_id == device_id)
    ).scalar_one_or_none()
    if not ep:
        return DeviceEndpointGetResponse(defined=False, endpoint=None, observability=None)
    return DeviceEndpointGetResponse(
        defined=True,
        endpoint=DeviceEndpointRead.model_validate(ep),
        observability=_to_observability(db, ep),
    )


@router.post("/validate", response_model=DeviceEndpointValidateResponse)
def validate_device_endpoint(
    body: DeviceEndpointValidateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Connectivity + payload-receipt check; does not save configuration."""
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, body.device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    ep = db.execute(
        select(DeviceEndpoint).where(DeviceEndpoint.device_id == body.device_id)
    ).scalar_one_or_none()

    if not ep:
        if (
            body.config is None
            or body.protocol is None
            or str(body.protocol).strip() == ""
            or body.polling_interval_seconds is None
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No saved endpoint yet — send protocol, config, and polling_interval_seconds to validate this draft.",
            )
        cfg = body.config if isinstance(body.config, dict) else {}
        proto = _normalize_protocol_value(str(body.protocol))
        poll_iv = max(0, int(body.polling_interval_seconds))
        st, detail = run_endpoint_validation(
            db,
            protocol=proto,
            config=cfg,
            device_id=body.device_id,
            polling_interval_seconds=poll_iv,
        )
        raw_obs = build_observability(
            db,
            device_id=body.device_id,
            protocol=proto,
            config=cfg if isinstance(cfg, dict) else {},
            polling_interval_seconds=poll_iv,
        )
        return DeviceEndpointValidateResponse(
            validation_status=st,
            validation_detail=detail,
            last_verified_at=None,
            observability=DeviceEndpointObservability.model_validate(raw_obs),
            endpoint=None,
        )

    cfg = ep.config if isinstance(ep.config, dict) else {}
    proto = _normalize_protocol_value(ep.protocol)
    try:
        poll_iv = int(ep.polling_interval_seconds)
    except (TypeError, ValueError):
        poll_iv = 60
    if poll_iv < 1:
        poll_iv = 60
    if body.config is not None:
        cfg = body.config if isinstance(body.config, dict) else {}
    if body.protocol is not None and str(body.protocol).strip():
        proto = _normalize_protocol_value(str(body.protocol))
    if body.polling_interval_seconds is not None:
        poll_iv = int(body.polling_interval_seconds)
        if poll_iv < 1:
            poll_iv = 60
    st, detail = run_endpoint_validation(
        db,
        protocol=proto,
        config=cfg,
        device_id=ep.device_id,
        polling_interval_seconds=poll_iv,
    )
    now = validation_timestamp()
    ep.last_verified_at = now
    ep.validation_status = st
    ep.validation_detail = detail
    sync_activation_after_validation(ep, validation_status=st)
    db.add(ep)
    db.commit()
    db.refresh(ep)
    return DeviceEndpointValidateResponse(
        validation_status=st,
        validation_detail=detail,
        last_verified_at=now,
        observability=_observability_for_validation(
            db,
            ep,
            protocol=proto,
            config=cfg if isinstance(cfg, dict) else {},
            polling_interval_seconds=poll_iv,
        ),
        endpoint=DeviceEndpointRead.model_validate(ep),
    )


@router.post("", response_model=DeviceEndpointRead)
def upsert_endpoint(
    body: DeviceEndpointCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("device_endpoints.upsert device_id=%s", body.device_id)
    allowed = allowed_site_ids_for_user(db, user)
    device = _load_device(db, body.device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    ep = db.execute(
        select(DeviceEndpoint).where(DeviceEndpoint.device_id == body.device_id)
    ).scalar_one_or_none()
    norm_proto = _normalize_protocol_value(body.protocol)
    if ep:
        ep.protocol = norm_proto
        ep.config = body.config
        ep.polling_interval_seconds = body.polling_interval_seconds
        ep.is_active = body.is_active
    else:
        ep = DeviceEndpoint(
            id=uuid.uuid4(),
            device_id=body.device_id,
            protocol=norm_proto,
            config=body.config,
            polling_interval_seconds=body.polling_interval_seconds,
            is_active=body.is_active,
        )
        db.add(ep)
    _invalidate_validation(ep)
    sync_activation_after_save(ep)
    push_mqtt_config_to_linked_v2_endpoint(db, ep)
    db.commit()
    db.refresh(ep)
    return DeviceEndpointRead.model_validate(ep)


@router.patch("/{endpoint_id}", response_model=DeviceEndpointRead)
def patch_endpoint(
    endpoint_id: uuid.UUID,
    body: DeviceEndpointUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log.debug("device_endpoints.patch %s", endpoint_id)
    allowed = allowed_site_ids_for_user(db, user)
    ep = db.get(DeviceEndpoint, endpoint_id)
    if not ep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Endpoint not found")
    device = _load_device(db, ep.device_id, user.customer_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    touched = False
    if body.protocol is not None:
        ep.protocol = _normalize_protocol_value(body.protocol)
        touched = True
    if body.config is not None:
        ep.config = body.config
        touched = True
    if body.polling_interval_seconds is not None:
        ep.polling_interval_seconds = body.polling_interval_seconds
        touched = True
    if body.is_active is not None:
        ep.is_active = body.is_active
        touched = True

    if touched:
        _invalidate_validation(ep)
    sync_activation_after_save(ep)
    db.add(ep)
    push_mqtt_config_to_linked_v2_endpoint(db, ep)
    db.commit()
    db.refresh(ep)
    return DeviceEndpointRead.model_validate(ep)
