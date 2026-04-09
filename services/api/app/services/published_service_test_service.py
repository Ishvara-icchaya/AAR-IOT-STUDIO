from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.user import User
from app.schemas.published_service import PublishedServiceTestResponse
from app.services.publish_dispatch import dispatch_publish
from app.services.published_service_service import (
    PublishedServiceNotFound,
    append_delivery_log,
    get_service,
    load_source_payload,
    redis_set_last_status,
)


def run_test_publish(
    db: Session,
    user: User,
    service_id: uuid.UUID,
    *,
    trace_id: str | None = None,
) -> PublishedServiceTestResponse:
    svc = get_service(db, user, service_id)
    if not svc:
        raise PublishedServiceNotFound()
    payload = load_source_payload(db, customer_id=user.customer_id, svc=svc)
    if not payload:
        raise ValueError("Source object not found or not accessible")
    tid = trace_id or str(uuid.uuid4())
    ok, code, msg = dispatch_publish(
        publish_protocol=svc.publish_protocol,
        target_config_json=dict(svc.target_config_json or {}),
        payload=payload,
    )
    append_delivery_log(
        db,
        service_id=svc.id,
        source_event_id=None,
        ok=ok,
        response_code=code,
        response_message=msg,
        trace_id=tid,
    )
    redis_set_last_status(
        svc.id,
        {
            "test": True,
            "ok": ok,
            "response_code": code,
            "trace_id": tid,
        },
    )
    return PublishedServiceTestResponse(
        ok=ok,
        status="success" if ok else "failed",
        response_code=code,
        response_message=msg,
        trace_id=tid,
    )
