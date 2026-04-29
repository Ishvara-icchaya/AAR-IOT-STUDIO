from app.services.dashboard_schema_migration import migrate_legacy_layout_to_grid


def test_migrate_legacy_layout_to_grid_basic_shape() -> None:
    payload = {
        "rows": [
            {
                "columns": [
                    {"span": 6, "widget": {"widgetId": "w1", "type": "kpi", "title": "A"}},
                    {"span": 6, "widget": {"widgetId": "w2", "type": "map", "title": "B"}},
                ]
            }
        ]
    }

    out = migrate_legacy_layout_to_grid(payload)
    assert out["schema_version"] == 2
    assert len(out["widgets"]) == 2
    assert len(out["layouts"]["lg"]) == 2
    assert out["layouts"]["lg"][0]["i"] == "w1"
