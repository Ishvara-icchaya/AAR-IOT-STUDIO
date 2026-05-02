"""V2 endpoint schema and router wiring smoke tests."""

from __future__ import annotations

import uuid

import pytest

from app.schemas.endpoint import EndpointCreate, EndpointUpdate


def test_endpoint_create_allows_omitted_primary_keys() -> None:
    e = EndpointCreate(
        site_id=uuid.uuid4(),
        endpoint_name="e",
        protocol="mqtt",
    )
    assert e.primary_device_key_fields is None


def test_endpoint_create_ok() -> None:
    e = EndpointCreate(
        site_id=uuid.uuid4(),
        endpoint_name="Gateway A",
        protocol="mqtt",
        primary_device_key_fields=["truck_id"],
        enabled=True,
    )
    assert e.endpoint_name == "Gateway A"


def test_endpoint_update_optional_fields() -> None:
    u = EndpointUpdate(endpoint_name="renamed")
    assert u.endpoint_name == "renamed"
    assert u.enabled is None


def test_endpoint_create_schema_excludes_object_name() -> None:
    assert "object_name" not in EndpointCreate.model_fields


def test_endpoint_update_schema_excludes_object_name() -> None:
    assert "object_name" not in EndpointUpdate.model_fields


def test_router_has_endpoints_routes() -> None:
    from app.api.v1 import endpoints as ep_module

    paths = {getattr(r, "path", None) for r in ep_module.router.routes}
    assert "" in paths
    assert "/{endpoint_id}" in paths
    assert "/{endpoint_id}/resolved-devices" in paths
    assert "/{endpoint_id}/latest-device-states" in paths
    assert "/{endpoint_id}/scrubbed-events" in paths
    assert "/{endpoint_id}/publish-identity" in paths
    assert "/{endpoint_id}/sample-field-metadata" in paths


def test_app_includes_endpoints_openapi_path() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/api/v1/endpoints" in paths
    assert "/api/v1/endpoints/{endpoint_id}" in paths
