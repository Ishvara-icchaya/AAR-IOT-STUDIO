"""Publish endpoint identity from draft; sole path to live PK + active lifecycle."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.endpoint import Endpoint
from app.services.primary_device_key import extract_primary_key_json


def _normalize_str_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def sample_document_for_validation(ep: Endpoint) -> dict[str, Any]:
    raw = ep.sample_payload
    if isinstance(raw, dict):
        inner = raw.get("_aar_array_sample")
        if isinstance(inner, list) and inner and isinstance(inner[0], dict):
            return dict(inner[0])
        return dict(raw)
    if isinstance(raw, list) and raw and isinstance(raw[0], dict):
        return dict(raw[0])
    return {}


def validate_identity_draft_against_sample(
    *, sample: dict[str, Any], draft: dict[str, Any]
) -> tuple[list[str], list[str], list[Any] | None, list[Any] | None, Any]:
    """Returns (errors, warnings, pk_fields, label_fields, location_fields)."""
    errs: list[str] = []
    warns: list[str] = []
    pk = _normalize_str_list(draft.get("primary_device_key_fields"))
    if not pk:
        errs.append("identity_draft.primary_device_key_fields must be a non-empty list of paths")
        return errs, warns, None, None, None
    if not sample:
        errs.append("endpoint has no sample_payload yet; ingest telemetry first")
        return errs, warns, None, None, None
    extracted = extract_primary_key_json(sample, pk)
    if not extracted:
        errs.append("primary_device_key_fields do not resolve to non-null scalars on the captured sample")
    labels = _normalize_str_list(draft.get("device_label_fields")) or None
    loc = draft.get("location_fields")
    if loc is not None and not isinstance(loc, (dict, list)):
        errs.append("location_fields must be a JSON object or array when set")
        loc = None
    return errs, warns, pk, labels, loc


def publish_endpoint_identity(db: Session, ep: Endpoint) -> Endpoint:
    if ep.identity_managed_by_scrubber:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Identity paths are managed by the published scrubber pipeline. Adjust Field semantics (identity/display roles) and republish the scrubber.",
        )
    draft = ep.identity_draft if isinstance(ep.identity_draft, dict) else {}
    sample = sample_document_for_validation(ep)
    errs, _warns, pk, labels, loc = validate_identity_draft_against_sample(sample=sample, draft=draft)
    if errs:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="; ".join(errs))

    now = datetime.now(timezone.utc)
    ep.primary_device_key_fields = pk
    ep.device_label_fields = labels
    if loc is not None:
        ep.location_fields = loc
    ep.identity_published_at = now
    ep.lifecycle_status = "active"
    ep.identity_managed_by_scrubber = False
    db.add(ep)
    db.commit()
    db.refresh(ep)
    return ep


def merge_identity_draft(existing: dict[str, Any] | None, patch: dict[str, Any]) -> dict[str, Any]:
    base = dict(existing or {})
    for k, v in patch.items():
        if v is None:
            base.pop(k, None)
        else:
            base[k] = v
    return base
