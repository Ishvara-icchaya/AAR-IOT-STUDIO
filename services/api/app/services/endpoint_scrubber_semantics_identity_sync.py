"""Apply Scrubber2 semantics (identity/display roles) to linked v2 ingest endpoints.

After scrubber freeze (published pipeline) or when linking an endpoint to a device, operators should
not need a separate identity-mapping UI if semantics already mark primary-key paths.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.device_endpoint import DeviceEndpoint
from app.models.endpoint import Endpoint
from app.models.raw_data_object import RawDataObject
from app.services.endpoint_identity_publish import sample_document_for_validation, validate_identity_draft_against_sample
from app.services.endpoint_sample_service import normalize_sample_document
from app.services.endpoint_scrubber_identity_hints import paths_from_device_mapping
from app.services.raw_preview import read_raw_slice
from app.services.scrubber_engine import run_scrubber
from minio.error import S3Error

log = logging.getLogger(__name__)


def _latest_raw_for_device(db: Session, device_id: uuid.UUID) -> RawDataObject | None:
    return db.execute(
        select(RawDataObject)
        .where(RawDataObject.device_id == device_id)
        .order_by(RawDataObject.ingested_at.desc().nulls_last(), RawDataObject.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def scrub_output_sample_for_identity_validation(
    db: Session,
    *,
    device_id: uuid.UUID,
    merged_mapping: dict[str, Any],
) -> dict[str, Any] | None:
    """Run the frozen scrubber on the latest archived raw for this device (same engine as preview)."""
    ss = merged_mapping.get("scrubberStudio")
    if not isinstance(ss, dict) or not ss.get("published"):
        return None
    raw = _latest_raw_for_device(db, device_id)
    if not raw or raw.size_bytes is None or raw.size_bytes <= 0:
        return None
    cap = min(int(raw.size_bytes), settings.raw_ingest_max_bytes)
    try:
        data, _total = read_raw_slice(storage_key=raw.storage_key, offset=0, max_bytes=cap)
    except S3Error as e:
        log.warning("scrubber_identity_sync raw read failed device_id=%s err=%s", device_id, e)
        return None
    try:
        result = run_scrubber(
            raw_bytes=data,
            content_type=raw.content_type,
            scrubber_studio=ss,
        )
    except Exception as e:
        log.warning("scrubber_identity_sync scrubber run failed device_id=%s err=%s", device_id, e)
        return None
    p = result.payload
    return p if isinstance(p, dict) else None


def scrub_dict_through_published_pipeline(
    scrubber_studio: dict[str, Any],
    document: dict[str, Any],
) -> dict[str, Any] | None:
    """Run the frozen pipeline on an in-memory JSON document (same engine as worker preview).

    Used when the endpoint's captured ``sample_payload`` is still **pre-scrubber** ingest shape
    but semantics paths refer to **post-pipeline** keys (e.g. flattened ``device_id``).
    """
    if not isinstance(scrubber_studio, dict) or not scrubber_studio.get("published"):
        return None
    try:
        raw_bytes = json.dumps(document, ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError):
        return None
    try:
        result = run_scrubber(
            raw_bytes=raw_bytes,
            content_type="application/json",
            scrubber_studio=scrubber_studio,
        )
    except Exception as e:
        log.warning("scrubber_identity_sync scrub_dict failed err=%s", e)
        return None
    p = result.payload
    return p if isinstance(p, dict) else None


def sync_v2_endpoint_identity_from_device_mapping(
    db: Session,
    *,
    device_id: uuid.UUID,
    merged_mapping: dict[str, Any],
    device_customer_id: uuid.UUID,
) -> None:
    """For every v2 endpoint linked to this device's Manage row, merge semantics into identity and publish when valid."""
    pk_paths, label_paths = paths_from_device_mapping(merged_mapping)
    if not pk_paths:
        return

    de = db.execute(select(DeviceEndpoint).where(DeviceEndpoint.device_id == device_id)).scalar_one_or_none()
    if de is None:
        return

    eps = db.execute(select(Endpoint).where(Endpoint.device_endpoint_id == de.id)).scalars().all()
    if not eps:
        return

    ss = merged_mapping.get("scrubberStudio")
    published = isinstance(ss, dict) and ss.get("published")
    scrubbed_from_latest_raw: dict[str, Any] | None = None
    if published:
        scrubbed_from_latest_raw = scrub_output_sample_for_identity_validation(
            db, device_id=device_id, merged_mapping=merged_mapping
        )

    for ep in eps:
        if ep.customer_id != device_customer_id:
            continue

        draft = dict(ep.identity_draft or {})
        draft["primary_device_key_fields"] = pk_paths
        if label_paths:
            draft["device_label_fields"] = label_paths

        captured = sample_document_for_validation(ep)
        sample: dict[str, Any] | None = None
        scrubbed_for_bootstrap: dict[str, Any] | None = None
        if published and isinstance(ss, dict):
            sample = scrubbed_from_latest_raw
            if sample is None and captured is not None:
                sample = scrub_dict_through_published_pipeline(ss, captured)
            if sample is not None:
                scrubbed_for_bootstrap = sample
        elif captured is not None:
            sample = captured

        ep.identity_draft = draft

        if not sample:
            log.info(
                "scrubber_identity_sync no validation sample endpoint_id=%s device_id=%s",
                ep.id,
                device_id,
            )
            if ep.identity_published_at is None:
                ep.lifecycle_status = "needs_identity_mapping"
            db.add(ep)
            continue

        errs, _warns, pk_norm, labels_norm, loc = validate_identity_draft_against_sample(sample=sample, draft=draft)
        if errs:
            log.info(
                "scrubber_identity_sync validation failed endpoint_id=%s errs=%s",
                ep.id,
                errs,
            )
            ep.lifecycle_status = "needs_identity_mapping"
            db.add(ep)
            continue

        now = datetime.now(timezone.utc)
        ep.primary_device_key_fields = pk_norm
        ep.device_label_fields = labels_norm
        if loc is not None:
            ep.location_fields = loc
        ep.identity_published_at = now
        ep.lifecycle_status = "active"
        if ep.sample_payload is None and scrubbed_for_bootstrap is not None:
            ep.sample_payload = normalize_sample_document(scrubbed_for_bootstrap)
            ep.sample_ingested_at = now
        db.add(ep)
        log.info("scrubber_identity_sync published endpoint_id=%s device_id=%s", ep.id, device_id)
