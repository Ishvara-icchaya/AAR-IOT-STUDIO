"""Acceptance-focused tests for endpoint-group dashboard source behavior."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.services import dashboard_live as dashboard_live_module
from app.services.dashboard_live import _load_source_record
from app.services.dashboard_resolved_device_collection import (
    ResolvedDeviceCollectionCursor,
    _mapping_has_pipeline_config,
    _pipeline_label_from_mapping,
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


def test_live_source_loader_data_object_returns_none_without_db_session() -> None:
    """ORM load requires a Session; callers with db=None get a null payload (e.g. unit stubs)."""
    payload, updated_at, display_name = _load_source_record(
        db=None,  # type: ignore[arg-type]
        customer_id=uuid.uuid4(),
        source_type="data_object",
        source_id=uuid.uuid4(),
    )
    assert payload is None
    assert updated_at is None
    assert display_name is None


def test_mapping_has_pipeline_config_accepts_scrubber2_model_only() -> None:
    assert _mapping_has_pipeline_config({"scrubber2": {"model": {"keepFields": []}}})
    assert not _mapping_has_pipeline_config({"scrubber2": {"model": {}}})
    assert not _mapping_has_pipeline_config({})


def test_pipeline_label_from_mapping_matches_pipelines_list_fallback() -> None:
    assert (
        _pipeline_label_from_mapping(
            "LG-Berger",
            {"scrubberStudio": {"draft": {"output_data_object": {"name": "  My Out  "}}}},
        )
        == "My Out"
    )
    assert _pipeline_label_from_mapping("LG-Berger", {}) == "LG-Berger Pipeline"
    assert _pipeline_label_from_mapping("", {}) == ""


def test_openapi_includes_endpoint_group_dashboard_routes() -> None:
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/api/v1/dashboards/sources/resolved-device-collections" in paths
    assert "/api/v1/dashboards/runtime/resolved-device-collection" in paths


def test_resolved_collection_table_auto_reflects_new_and_removed_devices(monkeypatch) -> None:
    base_widget = {
        "widgetId": "w-table",
        "type": "table",
        "title": "Fleet table",
        "binding": {
            "sourceType": "resolved_device_collection",
            "siteId": str(uuid.uuid4()),
            "endpointId": str(uuid.uuid4()),
            "objectName": "telemetry",
            "fields": [],
        },
        "config": {},
    }
    customer_id = uuid.uuid4()

    def first_rows(*args, **kwargs):
        return (
            [
                {
                    "latest_device_state_id": str(uuid.uuid4()),
                    "resolved_device_id": "dev-a",
                    "device_label": "Device A",
                    "device_type": "meter",
                    "lifecycle_status": "online",
                    "health_status": "healthy",
                    "last_event_ts": "2026-04-29T06:00:00+00:00",
                    "updated_at": "2026-04-29T06:00:00+00:00",
                },
                {
                    "latest_device_state_id": str(uuid.uuid4()),
                    "resolved_device_id": "dev-b",
                    "device_label": "Device B",
                    "device_type": "meter",
                    "lifecycle_status": "late",
                    "health_status": "warning",
                    "last_event_ts": "2026-04-29T06:01:00+00:00",
                    "updated_at": "2026-04-29T06:01:00+00:00",
                },
            ],
            {"total": 2, "online": 1, "late": 1, "offline": 0, "error": 0, "healthy": 1, "warning": 1, "critical": 0},
            None,
        )

    def second_rows(*args, **kwargs):
        return (
            [
                {
                    "latest_device_state_id": str(uuid.uuid4()),
                    "resolved_device_id": "dev-b",
                    "device_label": "Device B",
                    "device_type": "meter",
                    "lifecycle_status": "online",
                    "health_status": "healthy",
                    "last_event_ts": "2026-04-29T06:02:00+00:00",
                    "updated_at": "2026-04-29T06:02:00+00:00",
                },
                {
                    "latest_device_state_id": str(uuid.uuid4()),
                    "resolved_device_id": "dev-c",
                    "device_label": "Device C",
                    "device_type": "meter",
                    "lifecycle_status": "online",
                    "health_status": "healthy",
                    "last_event_ts": "2026-04-29T06:03:00+00:00",
                    "updated_at": "2026-04-29T06:03:00+00:00",
                },
            ],
            {"total": 2, "online": 2, "late": 0, "offline": 0, "error": 0, "healthy": 2, "warning": 0, "critical": 0},
            None,
        )

    monkeypatch.setattr(dashboard_live_module, "_load_resolved_collection_rows", first_rows)
    first = dashboard_live_module.resolve_widget_data(
        db=None,  # type: ignore[arg-type]
        customer_id=customer_id,
        widget=base_widget,
        dashboard_site_id=uuid.uuid4(),
    )
    first_ids = [r["resolved_device_id"] for r in first["data"]["rows"]]
    assert first_ids == ["dev-a", "dev-b"]

    monkeypatch.setattr(dashboard_live_module, "_load_resolved_collection_rows", second_rows)
    second = dashboard_live_module.resolve_widget_data(
        db=None,  # type: ignore[arg-type]
        customer_id=customer_id,
        widget=base_widget,
        dashboard_site_id=uuid.uuid4(),
    )
    second_ids = [r["resolved_device_id"] for r in second["data"]["rows"]]
    assert second_ids == ["dev-b", "dev-c"]


def test_resolved_collection_loader_paginates_and_aggregates(monkeypatch) -> None:
    class _State:
        def __init__(self, rid: str, lifecycle: str, health: str, score: float, updated: datetime):
            self.id = uuid.uuid4()
            self.resolved_device_id = uuid.UUID(rid)
            self.object_name = "telemetry"
            self.lifecycle_status = lifecycle
            self.health_status = health
            self.last_event_ts = updated
            self.location_json = {}
            self.identity_json = {}
            self.display_json = {}
            self.kpi_json = {}
            self.health_json = {"health_score": score}
            self.updated_at = updated

    class _RD:
        def __init__(self, label: str, device_type: str):
            self.device_label = label
            self.device_type = device_type

    page1 = [
        (
            _State(
                "00000000-0000-0000-0000-000000000001",
                "online",
                "healthy",
                90.0,
                datetime(2026, 4, 29, 6, 0, tzinfo=timezone.utc),
            ),
            _RD("Device 1", "meter"),
        )
    ]
    page2 = [
        (
            _State(
                "00000000-0000-0000-0000-000000000002",
                "offline",
                "critical",
                10.0,
                datetime(2026, 4, 29, 5, 59, tzinfo=timezone.utc),
            ),
            _RD("Device 2", "meter"),
        )
    ]
    calls = {"n": 0}

    def fake_query_collection_page(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return page1, "cursor-next", {}
        return page2, None, {}

    monkeypatch.setattr(dashboard_live_module, "query_collection_page", fake_query_collection_page)
    monkeypatch.setattr(dashboard_live_module, "decode_cursor", lambda _: object())

    rows, summary, err = dashboard_live_module._load_resolved_collection_rows(
        db=None,  # type: ignore[arg-type]
        customer_id=uuid.uuid4(),
        binding={
            "siteId": str(uuid.uuid4()),
            "endpointId": str(uuid.uuid4()),
            "objectName": "telemetry",
        },
        dashboard_site_id=None,
    )
    assert err is None
    assert len(rows) == 2
    assert summary["total"] == 2
    assert summary["online"] == 1
    assert summary["offline"] == 1
    assert summary["healthy"] == 1
    assert summary["critical"] == 1
    assert summary["avg_health_score"] == 50.0


def test_resolved_collection_map_load_passes_require_location(monkeypatch) -> None:
    captured: dict[str, bool] = {}

    def _fake_load(*_a, require_location: bool = False, **_k):
        captured["require_location"] = require_location
        empty_summary = {
            "total": 0,
            "online": 0,
            "late": 0,
            "offline": 0,
            "error": 0,
            "healthy": 0,
            "warning": 0,
            "critical": 0,
            "unknown": 0,
            "excluded_missing_location": 0,
        }
        return [], empty_summary, None

    monkeypatch.setattr(dashboard_live_module, "_load_resolved_collection_rows", _fake_load)
    for wtype in ("map", "location_heading_map"):
        dashboard_live_module.resolve_widget_data(
            db=None,  # type: ignore[arg-type]
            customer_id=uuid.uuid4(),
            widget={
                "widgetId": "w-map",
                "type": wtype,
                "title": "Fleet map",
                "binding": {
                    "sourceType": "resolved_device_collection",
                    "siteId": str(uuid.uuid4()),
                    "endpointId": str(uuid.uuid4()),
                    "objectName": "telemetry",
                },
                "config": {},
            },
            dashboard_site_id=uuid.uuid4(),
        )
        assert captured["require_location"] is True


def test_runtime_resolved_collection_openapi_has_contract_fields() -> None:
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    get_op = schema["paths"]["/api/v1/dashboards/runtime/resolved-device-collection"]["get"]
    param_names = {p["name"] for p in get_op.get("parameters", [])}
    assert "require_location" in param_names
    ref = get_op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    model_name = ref.rsplit("/", maxsplit=1)[-1]
    defn = schema["components"]["schemas"][model_name]
    props = defn.get("properties", {})
    assert "rollups" in props
    assert "trends" in props
    summary_ref = props["summary"]["$ref"]
    summary_name = summary_ref.rsplit("/", maxsplit=1)[-1]
    summary_def = schema["components"]["schemas"][summary_name]
    assert "excluded_missing_location" in summary_def.get("properties", {})


def test_resolved_collection_map_uses_latest_device_state_sources_only(monkeypatch) -> None:
    widget = {
        "widgetId": "w-map",
        "type": "map",
        "title": "Fleet map",
        "binding": {
            "sourceType": "resolved_device_collection",
            "siteId": str(uuid.uuid4()),
            "endpointId": str(uuid.uuid4()),
            "objectName": "telemetry",
            "latitudeField": "gps.lat",
            "longitudeField": "gps.lon",
        },
        "config": {"autoIncludeGpsObjects": False},
    }

    def _fake_load_resolved_collection_rows(*args, **kwargs):
        return (
            [
                {"latest_device_state_id": str(uuid.uuid4())},
                {"latest_device_state_id": str(uuid.uuid4())},
            ],
            {"total": 2, "online": 2, "late": 0, "offline": 0, "error": 0, "healthy": 2, "warning": 0, "critical": 0},
            None,
        )

    monkeypatch.setattr(
        dashboard_live_module,
        "_load_resolved_collection_rows",
        _fake_load_resolved_collection_rows,
    )
    out = dashboard_live_module.resolve_widget_data(
        db=None,  # type: ignore[arg-type]
        customer_id=uuid.uuid4(),
        widget=widget,
        dashboard_site_id=uuid.uuid4(),
    )
    included = out["data"]["included_sources"]
    assert len(included) == 2
    assert all(x["sourceType"] == "latest_device_state" for x in included)
