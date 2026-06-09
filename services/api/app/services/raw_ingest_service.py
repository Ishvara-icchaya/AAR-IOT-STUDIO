"""HTTP raw ingest: MinIO + Postgres + optional Kafka (canonical envelope v1)."""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from minio.error import S3Error
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control import user_may_access_site
from app.services.permission_service import site_ids_with_permission
from app.core.config import settings
from app.core.device_ingest_policy import device_version_status_allows_ingest
from app.core.protocol_sources import normalize_protocol_id, raw_row_protocol_source
from app.core.raw_lifecycle import (
    INGEST_ARCHIVED,
    INGEST_FAILED,
    INGEST_PUBLISHED_TO_KAFKA,
    INGEST_VERIFIED,
    VERIFY_ERROR,
    VERIFY_HEAD_MISSING,
    VERIFY_HEAD_OK,
    VERIFY_MISMATCH,
    VERIFY_NEVER,
    VERIFY_NO_CHECKSUM,
    VERIFY_OK,
    VERIFY_SIZE_MISMATCH,
)
from app.models.device import Device
from app.models.endpoint import Endpoint
from app.models.raw_data_object import RawDataObject
from app.models.user import User
from app.schemas.raw_ingest_contract import (
    RawIngestHttpResponse,
    RawObjectVerifyResponse,
    build_envelope,
)
from app.schemas.raw_preview import RawPreviewResponse
from app.services import kafka_raw_publish, minio_raw
from app.services.alert_emit import emit_alert
from app.services.device_endpoint_lifecycle import touch_after_archived_success
from app.services.endpoint_sample_service import (
    capture_first_sample_if_needed,
    endpoint_allows_raw_kafka_publish,
    payload_dict_from_raw_body,
)
from app.services.raw_preview import build_preview_payload, read_raw_slice

log = logging.getLogger(__name__)

_SAFE_EXT = re.compile(r"^[a-zA-Z0-9]{1,16}$")


def _suffix(filename: str | None, content_type: str | None) -> str:
    if filename:
        base = filename.rsplit("/", 1)[-1]
        if "." in base:
            ext = base.rsplit(".", 1)[-1]
            if _SAFE_EXT.match(ext):
                return f".{ext.lower()}"
    guess = mimetypes.guess_extension(content_type or "") or ".bin"
    return guess if guess.startswith(".") else ".bin"


def _storage_key(
    *,
    customer_id: uuid.UUID,
    device_id: uuid.UUID,
    raw_id: uuid.UUID,
    ingested_at: datetime,
    suffix: str,
) -> str:
    return (
        f"{customer_id}/{device_id}/"
        f"{ingested_at:%Y}/{ingested_at:%m}/{ingested_at:%d}/{raw_id}{suffix}"
    )


async def ingest_raw_upload(
    *,
    db: Session,
    user: User,
    device_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    file: UploadFile,
    captured_at: datetime | None,
    protocol_id: str | None,
    publish_kafka_override: bool | None,
    trace_id: str | None,
) -> RawIngestHttpResponse:
    norm_protocol = normalize_protocol_id(protocol_id)
    if protocol_id and str(protocol_id).strip() and norm_protocol is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "protocol_id must be [a-z][a-z0-9_-]{0,63} (normalized lowercase)",
        )
    allowed = site_ids_with_permission(db, user, "devices.read")
    device = db.execute(
        select(Device).where(Device.id == device_id, Device.customer_id == user.customer_id)
    ).scalar_one_or_none()
    if not device:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if not user_may_access_site(user, device.site_id, allowed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Site not permitted")
    if not device.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Device is inactive")
    if not device_version_status_allows_ingest(getattr(device, "version_status", None)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Device version_status is terminal (deprecated or rolled_back); ingest is disabled. "
            "Set version_status back to active or deactivate the endpoint if you only want to stop traffic.",
        )
    endpoint = db.execute(
        select(Endpoint).where(
            Endpoint.id == endpoint_id,
            Endpoint.customer_id == user.customer_id,
            Endpoint.enabled.is_(True),
        )
    ).scalar_one_or_none()
    if not endpoint:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "endpoint_id not found or disabled")
    if endpoint.site_id != device.site_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "endpoint_id site does not match device site")

    body = await file.read(settings.raw_ingest_max_bytes + 1)
    if len(body) > settings.raw_ingest_max_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Payload too large")

    ct = file.content_type or "application/octet-stream"
    suffix = _suffix(file.filename, ct)
    raw_id = uuid.uuid4()
    ingested_at = datetime.now(timezone.utc)
    storage_key = _storage_key(
        customer_id=user.customer_id,
        device_id=device_id,
        raw_id=raw_id,
        ingested_at=ingested_at,
        suffix=suffix,
    )
    checksum = hashlib.sha256(body).hexdigest()

    kafka_published = False
    kafka_error: str | None = None

    try:
        minio_raw.put_raw_object(storage_key, body, len(body), ct)
    except Exception as e:
        log.exception("MinIO put failed")
        try:
            emit_alert(
                db=db,
                category="ingest",
                severity="critical",
                title="Raw ingest: object storage write failed",
                message=str(e)[:2000],
                customer_id=user.customer_id,
                site_id=device.site_id,
                device_id=device_id,
                source_component="api.ingest",
                source_object_type="device",
                source_object_id=device_id,
                trace_id=trace_id,
            )
        except Exception:
            log.debug("ingest minio alert emit failed", exc_info=True)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Object storage failed") from e

    row = RawDataObject(
        id=raw_id,
        customer_id=user.customer_id,
        device_id=device_id,
        storage_key=storage_key,
        content_type=ct,
        size_bytes=len(body),
        captured_at=captured_at,
        ingested_at=ingested_at,
        checksum=checksum,
        ingest_status=INGEST_ARCHIVED,
        verify_status=VERIFY_NEVER,
        protocol_source=raw_row_protocol_source(norm_protocol),
        registered_endpoint_id=endpoint.id,
    )
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
        try:
            touch_after_archived_success(db, device_id=device_id, protocol_source=row.protocol_source)
            db.commit()
        except Exception:
            log.warning("device endpoint lifecycle touch failed after raw ingest", exc_info=True)
            db.rollback()
    except Exception as ex:
        db.rollback()
        try:
            emit_alert(
                db=db,
                category="ingest",
                severity="critical",
                title="Raw ingest: database persist failed",
                message=str(ex)[:2000],
                customer_id=user.customer_id,
                site_id=device.site_id,
                device_id=device_id,
                source_component="api.ingest",
                source_object_type="raw_data_object",
                source_object_id=raw_id,
                trace_id=trace_id,
            )
        except Exception:
            log.debug("ingest db-fail alert emit failed", exc_info=True)
        try:
            minio_raw.remove_raw_object(storage_key)
        except Exception:
            log.exception("MinIO cleanup after DB failure")
        raise

    payload_doc = payload_dict_from_raw_body(body, ct)
    capture_first_sample_if_needed(db, endpoint.id, payload_doc)
    db.refresh(endpoint)

    do_kafka = (
        settings.kafka_publish_raw_ingest
        if publish_kafka_override is None
        else publish_kafka_override
    )
    do_kafka = do_kafka and endpoint_allows_raw_kafka_publish(db, endpoint.id)
    if do_kafka:
        env = build_envelope(
            raw_object_id=raw_id,
            customer_id=user.customer_id,
            device_id=device_id,
            endpoint_id=endpoint.id,
            storage_key=storage_key,
            content_type=ct,
            size_bytes=len(body),
            checksum_sha256=checksum,
            captured_at=captured_at,
            source="upload",
            protocol_id=norm_protocol,
            original_filename=file.filename,
            trace_id=trace_id,
        )
        try:
            kafka_raw_publish.publish_raw_ingest(
                key_device_id=str(device_id),
                value=env.to_kafka_json_bytes(),
            )
            kafka_published = True
            row = db.get(RawDataObject, raw_id)
            if row:
                row.ingest_status = INGEST_PUBLISHED_TO_KAFKA
                db.add(row)
                db.commit()
                db.refresh(row)
        except Exception as e:
            kafka_error = str(e)[:500]
            log.warning("Kafka publish failed (ingest still persisted): %s", kafka_error)
            try:
                emit_alert(
                    db=db,
                    category="ingest",
                    severity="warning",
                    title="Raw ingest: Kafka publish failed",
                    message=kafka_error,
                    customer_id=user.customer_id,
                    site_id=device.site_id,
                    device_id=device_id,
                    source_component="api.ingest",
                    source_object_type="raw_data_object",
                    source_object_id=raw_id,
                    trace_id=trace_id,
                )
            except Exception:
                log.debug("ingest kafka alert emit failed", exc_info=True)

    final = db.get(RawDataObject, raw_id)
    assert final is not None
    return RawIngestHttpResponse(
        raw_object_id=raw_id,
        endpoint_id=endpoint.id,
        device_id=device_id,
        customer_id=user.customer_id,
        storage_key=storage_key,
        content_type=ct,
        size_bytes=len(body),
        checksum_sha256=checksum,
        captured_at=captured_at,
        ingested_at=ingested_at,
        ingest_status=final.ingest_status,
        protocol_source=final.protocol_source,
        trace_id=trace_id,
        kafka_published=kafka_published,
        kafka_error=kafka_error,
    )


def verify_raw_object(
    *,
    db: Session,
    user: User,
    raw_id: uuid.UUID,
    rehash: bool,
) -> RawObjectVerifyResponse:
    allowed = site_ids_with_permission(db, user, "devices.read")
    row = db.execute(
        select(RawDataObject).where(
            RawDataObject.id == raw_id,
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

    exists, remote_size = minio_raw.stat_raw_object(row.storage_key)
    checksum_match: bool | None = None
    now = datetime.now(timezone.utc)
    msg: str | None = None

    if not exists:
        row.verify_status = VERIFY_HEAD_MISSING
        row.verify_message = "Object not found in archive"
        row.ingest_status = INGEST_FAILED
    elif not rehash:
        if remote_size is not None and row.size_bytes is not None and remote_size != row.size_bytes:
            row.verify_status = VERIFY_SIZE_MISMATCH
            row.verify_message = f"archive size {remote_size} != recorded {row.size_bytes}"
        else:
            row.verify_status = VERIFY_HEAD_OK
            row.verify_message = None
    elif rehash:
        if not row.checksum:
            row.verify_status = VERIFY_NO_CHECKSUM
            row.verify_message = "No checksum stored; cannot rehash-verify"
        elif row.size_bytes is not None and row.size_bytes > settings.raw_ingest_max_bytes:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Object too large for rehash on this server",
            )
        else:
            try:
                data = minio_raw.read_raw_object_bytes(row.storage_key)
                checksum_match = hashlib.sha256(data).hexdigest() == row.checksum
                if checksum_match:
                    row.verify_status = VERIFY_OK
                    row.verified_at = now
                    row.verify_message = None
                    row.ingest_status = INGEST_VERIFIED
                else:
                    row.verify_status = VERIFY_MISMATCH
                    row.verify_message = "SHA-256 mismatch vs recorded checksum"
                    row.ingest_status = INGEST_FAILED
            except Exception as e:
                row.verify_status = VERIFY_ERROR
                row.verify_message = str(e)[:2000]
                log.exception("rehash verify failed")

    db.add(row)
    db.commit()
    db.refresh(row)

    latest_stmt = select(RawDataObject.id).where(
        RawDataObject.device_id == row.device_id,
        RawDataObject.customer_id == user.customer_id,
    )
    if allowed is not None:
        latest_stmt = latest_stmt.join(Device, Device.id == RawDataObject.device_id).where(
            Device.site_id.in_(allowed)
        )
    latest_id = db.execute(
        latest_stmt.order_by(
            RawDataObject.ingested_at.desc().nulls_last(),
            RawDataObject.id.desc(),
        ).limit(1)
    ).scalar_one_or_none()
    is_latest_for_device = latest_id is not None and latest_id == row.id

    return RawObjectVerifyResponse(
        raw_object_id=row.id,
        device_id=row.device_id,
        customer_id=row.customer_id,
        storage_key=row.storage_key,
        content_type=row.content_type,
        size_bytes=row.size_bytes,
        checksum_sha256=row.checksum,
        captured_at=row.captured_at,
        ingested_at=row.ingested_at,
        minio_exists=exists,
        minio_size_bytes=remote_size,
        checksum_match=checksum_match,
        ingest_status=row.ingest_status,
        verify_status=row.verify_status,
        verified_at=row.verified_at,
        verify_message=row.verify_message,
        is_latest_for_device=is_latest_for_device,
    )


def preview_raw_object(
    *,
    db: Session,
    user: User,
    raw_id: uuid.UUID,
    offset: int,
    max_bytes: int,
) -> RawPreviewResponse:
    allowed = site_ids_with_permission(db, user, "devices.read")
    row = db.execute(
        select(RawDataObject).where(
            RawDataObject.id == raw_id,
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

    cap = max(1, min(max_bytes, settings.raw_preview_max_bytes))
    if offset < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "offset must be >= 0")
    if row.size_bytes is not None and offset >= row.size_bytes:
        return RawPreviewResponse(
            raw_object_id=row.id,
            offset=offset,
            requested_max_bytes=cap,
            total_size=row.size_bytes,
            returned_bytes=0,
            truncated=False,
            content_type=row.content_type,
            encoding="utf8",
            text="",
            base64=None,
        )
    if row.size_bytes is not None:
        cap = min(cap, row.size_bytes - offset)

    try:
        data, total = read_raw_slice(
            storage_key=row.storage_key,
            offset=offset,
            max_bytes=cap,
        )
    except S3Error as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Could not read object from archive",
        ) from e

    enc, txt, b64 = build_preview_payload(content_type=row.content_type, data=data)
    size_hint = total if total is not None else row.size_bytes
    truncated = False
    if size_hint is not None:
        truncated = offset + len(data) < size_hint
    elif len(data) >= cap:
        truncated = True

    if enc == "utf8":
        return RawPreviewResponse(
            raw_object_id=row.id,
            offset=offset,
            requested_max_bytes=cap,
            total_size=size_hint,
            returned_bytes=len(data),
            truncated=truncated,
            content_type=row.content_type,
            encoding="utf8",
            text=txt,
            base64=None,
        )
    return RawPreviewResponse(
        raw_object_id=row.id,
        offset=offset,
        requested_max_bytes=cap,
        total_size=size_hint,
        returned_bytes=len(data),
        truncated=truncated,
        content_type=row.content_type,
        encoding="base64",
        text=None,
        base64=b64,
    )
