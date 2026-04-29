"""Acceptance-focused tests for endpoint-group dashboard source behavior."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.services.dashboard_live import _load_source_record
from app.services.dashboard_resolved_device_collection import (
    ResolvedDeviceCollectionCursor,
    decode_cursor,
    encode_cursor,
    health_summary_bucket,
    lifecycle_summary_bucket,
)
from app.services.dashboard_validation import ALLOWED_SOURCE, validate_layout_for_save


def test_allowed_sources_include_resolved_collection_and_exclude_data_object() -> None:
    assert "resolved_device_collection" in ALLOWED_SOURCE
    assert "data_object" not in ALLOWED_SOURCE


def test_validate_layout_accepts_endpoint_group_binding() -> None:
    layout = {
        "version": 1,
        "rows": [
            {
                "rowId": "r1",
                "columns": [
                    {
                        "columnId": "c1",
                        "span": 12,
                        "widget": {
                            "widgetId": "w1",
                            "type": "kpi",
                            "title": "Fleet total",
                            "binding": {
                                "sourceType": "resolved_device_collection",
                                "siteId": str(uuid.uuid4()),
                                "endpointId": str(uuid.uuid4()),
                                "objectName": "telemetry",
                                "metric": "total",
                            },
                            "config": {},
                        },
                    }
                ],
            }
        ],
    }
    errs = validate_layout_for_save(layout=layout, site_id=uuid.uuid4(), require_widgets=True)
    assert errs == []


def test_validate_layout_rejects_missing_endpoint_group_fields() -> None:
    layout = {
        "version": 1,
        "rows": [
            {
                "rowId": "r1",
                "columns": [
                    {
                        "columnId": "c1",
                        "span": 12,
                        "widget": {
                            "widgetId": "w1",
                            "type": "table",
                            "title": "Fleet",
                            "binding": {
                                "sourceType": "resolved_device_collection",
                                # missing siteId / endpointId / objectName
                            },
                            "config": {},
                        },
                    }
                ],
            }
        ],
    }
    errs = validate_layout_for_save(layout=layout, site_id=uuid.uuid4(), require_widgets=True)
    assert any("endpoint_id + object_name" in e for e in errs)
    assert any("site_id in binding" in e for e in errs)


def test_cursor_round_trip_for_resolved_device_collection() -> None:
    c = ResolvedDeviceCollectionCursor(
        updated_at=datetime(2026, 4, 29, 6, 0, tzinfo=timezone.utc),
        scrubbed_event_id=uuid.uuid4(),
        resolved_device_id=uuid.uuid4(),
    )
    encoded = encode_cursor(c)
    decoded = decode_cursor(encoded)
    assert decoded.updated_at == c.updated_at
    assert decoded.scrubbed_event_id == c.scrubbed_event_id
    assert decoded.resolved_device_id == c.resolved_device_id


def test_status_bucket_vocabulary_mapping() -> None:
    assert lifecycle_summary_bucket("online") == "online"
    assert lifecycle_summary_bucket("late") == "late"
    assert lifecycle_summary_bucket("offline") == "offline"
    assert lifecycle_summary_bucket("error") == "error"
    assert health_summary_bucket("green") == "healthy"
    assert health_summary_bucket("warning") == "warning"
    assert health_summary_bucket("critical") == "critical"
    assert health_summary_bucket("something-else") == "unknown"


def test_live_source_loader_has_no_data_object_fallback() -> None:
    payload, updated_at, display_name = _load_source_record(
        db=None,  # type: ignore[arg-type]
        customer_id=uuid.uuid4(),
        source_type="data_object",
        source_id=uuid.uuid4(),
    )
    assert payload is None
    assert updated_at is None
    assert display_name is None


def test_openapi_includes_endpoint_group_dashboard_routes() -> None:
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/api/v1/dashboards/sources/resolved-device-collections" in paths
    assert "/api/v1/dashboards/runtime/resolved-device-collection" in paths
