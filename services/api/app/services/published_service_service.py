from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.access_control import ensure_site_in_tenant, allowed_site_ids_for_user, user_may_access_site
from app.core.config import settings
from app.core.redis_sync import get_redis
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.published_service import PublishedService
from app.models.published_service_delivery_log import PublishedServiceDeliveryLog
from app.models.user import User
from app.models.workflow_result_object import WorkflowResultObject
from app.schemas.published_service import (
    PublishedServiceCreate,
    PublishedServiceDeliveryLogListResponse,
    PublishedServiceDeliveryLogRead,
    PublishedServiceDetailResponse,
    PublishedServiceListResponse,
    PublishedServiceRead,
    PublishedServiceSourcesDataObjectsResponse,
    PublishedServiceSourcesResultObjectsResponse,
    PublishedServiceUpdate,
    DataObjectSourceRef,
    ResultObjectSourceRef,
)
from app.services.published_service_validation import validate_target_config

log = logging.getLogger(__name__)


class PublishedServiceNotFound(Exception):
    pass


class PublishedServiceForbidden(Exception):
    pass


def _access_service(db: Session, user: User, svc: PublishedService | None) -> PublishedService:
    if not svc or svc.customer_id != user.customer_id:
        raise PublishedServiceNotFound()
    allowed = allowed_site_ids_for_user(db, user)
    if not user_may_access_site(user, svc.site_id, allowed):
        raise PublishedServiceForbidden()
    return svc


def require_published_service(db: Session, user: User, service_id: uuid.UUID) -> PublishedService:
    """Load by id and enforce tenant + site access (403 vs 404 via exceptions)."""
    s = db.get(PublishedService, service_id)
    return _access_service(db, user, s)


def list_services(
    db: Session,
    user: User,
    *,
    site_id: uuid.UUID | None = None,
    status: str | None = None,
    publish_protocol: str | None = None,
    search: str | None = None,
) -> PublishedServiceListResponse:
    allowed = allowed_site_ids_for_user(db, user)
    stmt = select(PublishedService).where(PublishedService.customer_id == user.customer_id)
    if allowed is not None and len(allowed) == 0:
        return PublishedServiceListResponse(items=[])
    if site_id is not None:
        stmt = stmt.where(PublishedService.site_id == site_id)
        if allowed is not None and site_id not in allowed:
            raise PublishedServiceForbidden()
    elif allowed is not None:
        stmt = stmt.where(PublishedService.site_id.in_(allowed))
    if status:
        stmt = stmt.where(PublishedService.status == status.strip())
    if publish_protocol:
        stmt = stmt.where(PublishedService.publish_protocol == publish_protocol.strip().lower())
    if search and search.strip():
        q = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                PublishedService.name.ilike(q),
                PublishedService.source_object_name.ilike(q),
            )
        )
    stmt = stmt.order_by(PublishedService.updated_at.desc())
    rows = list(db.scalars(stmt).all())
    return PublishedServiceListResponse(items=[PublishedServiceRead.model_validate(r) for r in rows])


def get_service(db: Session, user: User, service_id: uuid.UUID) -> PublishedService | None:
    try:
        return require_published_service(db, user, service_id)
    except PublishedServiceNotFound:
        return None
    except PublishedServiceForbidden:
        raise


def create_service(db: Session, user: User, body: PublishedServiceCreate) -> PublishedService:
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
    if not site:
        raise ValueError("site not found")
    if not user_may_access_site(user, body.site_id, allowed):
        raise PublishedServiceForbidden()
    errs = validate_target_config(
        publish_protocol=body.publish_protocol, target_config_json=body.target_config_json
    )
    if errs:
        raise ValueError("; ".join(errs))
    row = PublishedService(
        id=uuid.uuid4(),
        customer_id=user.customer_id,
        site_id=body.site_id,
        name=body.name.strip(),
        description=body.description,
        source_type=body.source_type,
        source_object_id=body.source_object_id,
        source_object_name=body.source_object_name.strip(),
        publish_protocol=body.publish_protocol,
        target_config_json=dict(body.target_config_json or {}),
        status=body.status,
        created_by_user_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_service(
    db: Session, user: User, service_id: uuid.UUID, body: PublishedServiceUpdate
) -> PublishedService | None:
    row = get_service(db, user, service_id)
    if not row:
        return None
    if body.site_id is not None:
        site = ensure_site_in_tenant(db, user.customer_id, body.site_id)
        if not site:
            raise ValueError("site not found")
        allowed = allowed_site_ids_for_user(db, user)
        if not user_may_access_site(user, body.site_id, allowed):
            raise PublishedServiceForbidden()
        row.site_id = body.site_id
    if body.name is not None:
        row.name = body.name.strip()
    if body.description is not None:
        row.description = body.description
    if body.source_object_name is not None:
        row.source_object_name = body.source_object_name.strip()
    proto = body.publish_protocol or row.publish_protocol
    cfg = body.target_config_json if body.target_config_json is not None else row.target_config_json
    if body.publish_protocol is not None:
        row.publish_protocol = body.publish_protocol
    if body.target_config_json is not None:
        row.target_config_json = dict(body.target_config_json)
    if body.status is not None:
        row.status = body.status
    errs = validate_target_config(publish_protocol=proto, target_config_json=dict(cfg or {}))
    if errs:
        raise ValueError("; ".join(errs))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_service(db: Session, user: User, service_id: uuid.UUID) -> bool:
    try:
        row = require_published_service(db, user, service_id)
    except PublishedServiceNotFound:
        return False
    except PublishedServiceForbidden:
        raise
    db.delete(row)
    db.commit()
    return True


def set_status(db: Session, user: User, service_id: uuid.UUID, status: str) -> PublishedService | None:
    try:
        row = require_published_service(db, user, service_id)
    except PublishedServiceNotFound:
        return None
    except PublishedServiceForbidden:
        raise
    row.status = status
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_service_detail(
    db: Session, user: User, service_id: uuid.UUID, log_limit: int = 100
) -> PublishedServiceDetailResponse | None:
    try:
        row = require_published_service(db, user, service_id)
    except PublishedServiceNotFound:
        return None
    except PublishedServiceForbidden:
        raise
    logs = list_delivery_logs(db, user, service_id, limit=log_limit)
    return PublishedServiceDetailResponse(
        service=PublishedServiceRead.model_validate(row),
        delivery_logs=logs.items,
    )


def list_delivery_logs(
    db: Session, user: User, service_id: uuid.UUID, limit: int = 100
) -> PublishedServiceDeliveryLogListResponse:
    if not get_service(db, user, service_id):
        raise PublishedServiceNotFound()
    stmt = (
        select(PublishedServiceDeliveryLog)
        .where(PublishedServiceDeliveryLog.published_service_id == service_id)
        .order_by(PublishedServiceDeliveryLog.published_at.desc())
        .limit(min(limit, 500))
    )
    rows = list(db.scalars(stmt).all())
    return PublishedServiceDeliveryLogListResponse(
        items=[PublishedServiceDeliveryLogRead.model_validate(r) for r in rows]
    )


def list_data_object_sources(
    db: Session, user: User, site_id: uuid.UUID
) -> PublishedServiceSourcesDataObjectsResponse:
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise ValueError("site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise PublishedServiceForbidden()
    stmt = (
        select(DataObject)
        .join(Device, Device.id == DataObject.device_id)
        .where(
            DataObject.customer_id == user.customer_id,
            Device.site_id == site_id,
        )
        .order_by(DataObject.updated_at.desc())
        .limit(500)
    )
    rows = list(db.scalars(stmt).all())
    return PublishedServiceSourcesDataObjectsResponse(
        items=[
            DataObjectSourceRef(
                id=r.id,
                device_id=r.device_id,
                site_id=r.site_id,
                name=r.name,
                lifecycle_status=r.lifecycle_status,
            )
            for r in rows
        ]
    )


def list_result_object_sources(
    db: Session, user: User, site_id: uuid.UUID
) -> PublishedServiceSourcesResultObjectsResponse:
    allowed = allowed_site_ids_for_user(db, user)
    site = ensure_site_in_tenant(db, user.customer_id, site_id)
    if not site:
        raise ValueError("site not found")
    if not user_may_access_site(user, site_id, allowed):
        raise PublishedServiceForbidden()
    stmt = (
        select(WorkflowResultObject)
        .where(
            WorkflowResultObject.customer_id == user.customer_id,
            WorkflowResultObject.site_id == site_id,
        )
        .order_by(WorkflowResultObject.created_at.desc())
        .limit(500)
    )
    rows = list(db.scalars(stmt).all())
    return PublishedServiceSourcesResultObjectsResponse(
        items=[
            ResultObjectSourceRef(
                id=r.id,
                workflow_id=r.workflow_id,
                result_object_name=r.result_object_name,
                site_id=r.site_id,
            )
            for r in rows
        ]
    )


def load_source_payload(db: Session, *, customer_id: uuid.UUID, svc: PublishedService) -> dict[str, Any] | None:
    if svc.source_type == "data_object":
        row = db.get(DataObject, svc.source_object_id)
        if not row or row.customer_id != customer_id:
            return None
        return {
            "source_type": "data_object",
            "data_object_id": str(row.id),
            "name": row.name,
            "payload": dict(row.payload or {}),
            "kpi_json": dict(row.kpi_json or {}),
            "health_status": row.health_status,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
    row = db.get(WorkflowResultObject, svc.source_object_id)
    if not row or row.customer_id != customer_id:
        return None
    return {
        "source_type": "result_object",
        "result_object_id": str(row.id),
        "result_object_name": row.result_object_name,
        "workflow_id": str(row.workflow_id),
        "payload": dict(row.payload_json or {}),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def append_delivery_log(
    db: Session,
    *,
    service_id: uuid.UUID,
    source_event_id: uuid.UUID | None,
    ok: bool,
    response_code: str | None,
    response_message: str | None,
    trace_id: str | None,
) -> PublishedServiceDeliveryLog:
    log_row = PublishedServiceDeliveryLog(
        id=uuid.uuid4(),
        published_service_id=service_id,
        source_event_id=source_event_id,
        status="success" if ok else "failed",
        response_code=response_code,
        response_message=response_message,
        trace_id=trace_id,
    )
    db.add(log_row)
    db.commit()
    db.refresh(log_row)
    return log_row


def update_service_after_publish(
    db: Session,
    svc: PublishedService,
    *,
    ok: bool,
    error_message: str | None,
) -> None:
    svc.last_published_at = datetime.now(timezone.utc)
    if ok:
        svc.last_error_message = None
    else:
        svc.last_error_message = error_message
        if svc.status == "active":
            svc.status = "failed"
    db.add(svc)
    db.commit()


def redis_set_last_status(service_id: uuid.UUID, payload: dict[str, Any]) -> None:
    r = get_redis()
    if not r:
        return
    try:
        r.set(
            f"published_service:last_status:{service_id}",
            json.dumps(payload, default=str),
            ex=86400,
        )
    except Exception:
        log.debug("redis last_status set failed", exc_info=True)


def prune_published_service_delivery_logs(
    db: Session,
    *,
    older_than_days: int | None = None,
) -> int:
    """Delete delivery log rows older than ``older_than_days`` (or settings default).

    Call from a scheduler when ``PUBLISHED_SERVICE_DELIVERY_LOG_RETENTION_DAYS`` is set.
    Returns number of rows removed.
    """
    days = older_than_days
    if days is None:
        days = settings.published_service_delivery_log_retention_days
    if days is None or days < 1:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=int(days))
    res = db.execute(delete(PublishedServiceDeliveryLog).where(PublishedServiceDeliveryLog.published_at < cutoff))
    db.commit()
    return int(res.rowcount or 0)
