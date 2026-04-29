"""First-sample capture + Kafka gate for v2 endpoints (API path, SQLAlchemy)."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.endpoint import Endpoint

log = logging.getLogger(__name__)


def normalize_sample_document(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return dict(payload)
    if isinstance(payload, list):
        return {"_aar_array_sample": payload[:20]}
    return {"_aar_scalar_sample": payload}


def payload_dict_from_raw_body(body: bytes, content_type: str | None) -> dict[str, Any]:
    ct = (content_type or "").lower()
    if not body:
        return {}
    if "json" in ct or body[:1] in (b"{", b"["):
        try:
            parsed = json.loads(body.decode("utf-8"))
            return normalize_sample_document(parsed)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {"_aar_parse_error": True, "size_bytes": len(body)}
    return {"_aar_non_json_body": True, "size_bytes": len(body), "content_type": ct or ""}


def _pk_empty(ep: Endpoint) -> bool:
    pk = ep.primary_device_key_fields
    if pk is None:
        return True
    if isinstance(pk, list):
        return len(pk) == 0
    return False


def capture_first_sample_if_needed(db: Session, endpoint_id: uuid.UUID, sample_doc: dict[str, Any]) -> None:
    ep = db.get(Endpoint, endpoint_id)
    if not ep:
        return
    if ep.identity_published_at is not None:
        return
    if not _pk_empty(ep):
        return
    if ep.sample_payload is not None:
        return
    ep.sample_payload = sample_doc
    ep.sample_ingested_at = datetime.now(timezone.utc)
    if (ep.lifecycle_status or "") in ("draft", "needs_sample", ""):
        ep.lifecycle_status = "needs_identity_mapping"
    db.add(ep)
    db.commit()


def endpoint_allows_raw_kafka_publish(db: Session, endpoint_id: uuid.UUID) -> bool:
    row = db.execute(
        text("SELECT identity_published_at FROM endpoints WHERE id = :id"),
        {"id": str(endpoint_id)},
    ).fetchone()
    if not row:
        return True
    return row[0] is not None
