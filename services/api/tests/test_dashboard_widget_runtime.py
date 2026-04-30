"""Unit and OpenAPI checks for dashboard widget runtime contract APIs."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.dashboard_widget_types import (
    ENDPOINT_COLLECTION_KPI,
    LOCATION_HEADING_MAP,
    OPS_ALERT_TRENDS,
    UNSUPPORTED,
    canonical_widget_type,
)
from app.main import app


def test_canonical_widget_type_maps_storage_aliases() -> None:
    assert canonical_widget_type("ops_alert_trends") == OPS_ALERT_TRENDS
    assert canonical_widget_type("kpi") == ENDPOINT_COLLECTION_KPI
    assert canonical_widget_type("map") == LOCATION_HEADING_MAP


def test_canonical_widget_type_unknown_returns_unsupported() -> None:
    assert canonical_widget_type("not_a_registered_type") == UNSUPPORTED
    assert canonical_widget_type("") == UNSUPPORTED


def test_openapi_includes_runtime_layout_and_resolve_batch() -> None:
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/api/v1/dashboards/{dashboard_id}/runtime-layout" in paths
    assert "/api/v1/dashboards/runtime/widgets/resolve-batch" in paths
