"""HTTP raw upload — canonical contract v1 (MinIO + DB + optional Kafka)."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.pipeline_log import emit as pipeline_emit
from app.core.request_context import snapshot
from app.db.session import get_db
from app.models.user import User
from app.schemas.raw_ingest_contract import RawIngestHttpResponse
from app.services import ingress_metrics
from app.services.raw_ingest_service import ingest_raw_upload

router = APIRouter()
log = logging.getLogger(__name__)


def _parse_captured_at(raw: str | None) -> datetime | None:
    if raw is None or not str(raw).strip():
        return None
    s = str(raw).strip()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "captured_at must be ISO-8601 datetime",
        ) from e


@router.post("/raw", response_model=RawIngestHttpResponse, status_code=status.HTTP_201_CREATED)
async def post_raw_ingest(
    device_id: uuid.UUID = Form(..., description="Registered device to attach this blob to"),
    endpoint_id: uuid.UUID = Form(..., description="Resolved v2 endpoint identity (required)"),
    file: UploadFile = File(..., description="Raw payload bytes"),
    captured_at: str | None = Form(
        None,
        description="Optional device-side capture time (ISO-8601)",
    ),
    protocol_id: str | None = Form(
        None,
        description="Optional subscriber key (e.g. modbus, mqtt) for worker dispatch",
    ),
    publish_kafka: bool | None = Query(
        None,
        description="Override KAFKA_PUBLISH_RAW_INGEST for this request",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t0 = time.perf_counter()
    try:
        cap = _parse_captured_at(captured_at)
        result = await ingest_raw_upload(
            db=db,
            user=user,
            device_id=device_id,
            endpoint_id=endpoint_id,
            file=file,
            captured_at=cap,
            protocol_id=(protocol_id.strip() if protocol_id else None),
            publish_kafka_override=publish_kafka,
            trace_id=snapshot().get("trace_id"),
        )
        ingress_metrics.record_rest_ingest_ok(
            latency_ms=int((time.perf_counter() - t0) * 1000),
        )
        pipeline_emit(
            log,
            component="api.ingest",
            action="http_upload",
            status="ok",
            raw_object_id=str(result.raw_object_id),
            device_id=str(result.device_id),
            size_bytes=result.size_bytes,
            kafka_published=result.kafka_published,
        )
        return result
    except HTTPException as e:
        ingress_metrics.record_rest_ingest_http_error(
            status_code=e.status_code,
            detail=str(e.detail) if e.detail is not None else "",
        )
        raise
    except Exception:
        ingress_metrics.record_rest_ingest_error(kind="internal_exception")
        raise
