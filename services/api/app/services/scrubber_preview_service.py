"""Server-side scrubber preview using the same engine as worker-scrubber."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control import allowed_site_ids_for_user, user_may_access_site
from app.models.device import Device
from app.models.device_object import DeviceObject
from app.models.raw_data_object import RawDataObject
from app.models.user import User
from app.schemas.device_object import merge_device_object_mapping
from app.schemas.scrubber_preview import ScrubberPreviewRequest, ScrubberPreviewResponse, ScrubberPreviewResult
from app.services.raw_preview import read_raw_slice
from app.services.scrubber_engine import run_scrubber
from app.core.config import settings
from minio.error import S3Error


def scrubber_preview(
    *,
    db: Session,
    user: User,
    body: ScrubberPreviewRequest,
) -> ScrubberPreviewResponse:
    allowed = allowed_site_ids_for_user(db, user)
    row = db.execute(
        select(RawDataObject).where(
            RawDataObject.id == body.raw_object_id,
            RawDataObject.customer_id == user.customer_id,
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Raw object not found")

    device = db.get(Device, row.device_id)
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device missing")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")

    dobj = db.execute(
        select(DeviceObject).where(DeviceObject.device_id == row.device_id)
    ).scalar_one_or_none()
    base_mapping: dict = dict(dobj.mapping) if dobj and isinstance(dobj.mapping, dict) else {}
    if body.use_stored_mapping and body.mapping:
        merged = merge_device_object_mapping(base_mapping, body.mapping)
    elif body.mapping:
        merged = dict(body.mapping)
    else:
        merged = base_mapping

    ss = merged.get("scrubberStudio")
    scrubber_studio = ss if isinstance(ss, dict) else None
    if not scrubber_studio:
        return ScrubberPreviewResponse(
            raw_object_id=row.id,
            device_id=row.device_id,
            preview=ScrubberPreviewResult(
                object_name="Data object",
                output_payload={},
                kpi={},
                health_status="red",
                health_code="no_scrubber",
                health_message="device_objects.mapping.scrubberStudio missing",
            ),
            error="scrubberStudio missing",
        )

    if row.size_bytes is None or row.size_bytes <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Raw object has no size; cannot preview transform")

    cap = min(int(row.size_bytes), settings.raw_ingest_max_bytes)
    try:
        data, _total = read_raw_slice(storage_key=row.storage_key, offset=0, max_bytes=cap)
    except S3Error as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Could not read object from archive",
        ) from e

    try:
        result = run_scrubber(
            raw_bytes=data,
            content_type=row.content_type,
            scrubber_studio=scrubber_studio,
        )
    except Exception as e:
        return ScrubberPreviewResponse(
            raw_object_id=row.id,
            device_id=row.device_id,
            preview=ScrubberPreviewResult(
                object_name="Data object",
                output_payload={},
                kpi={},
                health_status="red",
                health_code="transform_error",
                health_message=str(e)[:2000],
            ),
            error=str(e)[:2000],
        )

    return ScrubberPreviewResponse(
        raw_object_id=row.id,
        device_id=row.device_id,
        preview=ScrubberPreviewResult(
            object_name=result.object_name,
            output_payload=result.payload,
            kpi=result.kpi,
            health_status=result.health_status,
            health_code=result.health_code,
            health_message=result.health_message,
            scrubber_version=result.scrubber_version,
            health_details=result.health_details,
        ),
        error=None,
    )
