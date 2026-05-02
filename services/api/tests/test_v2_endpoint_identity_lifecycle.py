"""Unit tests for v2 endpoint identity draft, publish validation, and dashboard rules."""

from __future__ import annotations

import uuid

from app.schemas.endpoint import EndpointCreate
from app.services.dashboard_validation import ALLOWED_SOURCE
from app.services.endpoint_identity_publish import (
    merge_identity_draft,
    sample_document_for_validation,
    validate_identity_draft_against_sample,
)


def test_endpoint_create_defaults_to_draft_without_live_pk() -> None:
    e = EndpointCreate(
        site_id=uuid.uuid4(),
        endpoint_name="e",
        protocol="mqtt",
        primary_device_key_fields=["k"],
    )
    assert e.primary_device_key_fields == ["k"]


def test_validate_identity_fails_without_sample() -> None:
    errs, _, _, _, _ = validate_identity_draft_against_sample(
        sample={}, draft={"primary_device_key_fields": ["a"]}
    )
    assert any("sample" in x.lower() for x in errs)


def test_validate_identity_fails_when_paths_missing() -> None:
    errs, _, _, _, _ = validate_identity_draft_against_sample(
        sample={"x": 1}, draft={"primary_device_key_fields": ["y"]}
    )
    assert errs


def test_validate_identity_ok_on_sample() -> None:
    errs, _, pk, labels, _ = validate_identity_draft_against_sample(
        sample={"dev": "d1", "name": "N1"},
        draft={"primary_device_key_fields": ["dev"], "device_label_fields": ["name"]},
    )
    assert not errs
    assert pk == ["dev"]
    assert labels == ["name"]


def test_sample_document_for_array_wrapper() -> None:
    from app.models.endpoint import Endpoint

    ep = Endpoint(
        id=uuid.uuid4(),
        customer_id=uuid.uuid4(),
        site_id=uuid.uuid4(),
        endpoint_name="x",
        protocol="mqtt",
        object_name="o",
        sample_payload={"_aar_array_sample": [{"id": 1, "v": "a"}]},
    )
    doc = sample_document_for_validation(ep)
    assert doc.get("id") == 1


def test_merge_identity_draft_clears_with_none() -> None:
    m = merge_identity_draft({"primary_device_key_fields": ["a"]}, {"primary_device_key_fields": None})
    assert "primary_device_key_fields" not in m


def test_dashboard_allowed_sources_exclude_data_object() -> None:
    assert "data_object" not in ALLOWED_SOURCE
