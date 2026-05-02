"""Scrubber semantics → v2 identity path hints."""

from __future__ import annotations

from app.services.endpoint_scrubber_identity_hints import paths_from_device_mapping, paths_from_scrubber2_model


def test_paths_from_scrubber2_model_identity_and_display() -> None:
    model = {
        "fieldSemantics": [
            {"path": "device_id", "roles": ["identity", "metric"]},
            {"path": "name", "roles": ["display"]},
            {"path": "ignored", "roles": ["filter"]},
        ]
    }
    pk, labels = paths_from_scrubber2_model(model)
    assert pk == ["device_id"]
    assert labels == ["name"]


def test_paths_from_device_mapping_nested() -> None:
    mapping = {
        "scrubber2": {
            "model": {
                "fieldSemantics": [
                    {"path": "unit.serial", "roles": ["identity"]},
                ]
            }
        }
    }
    pk, labels = paths_from_device_mapping(mapping)
    assert pk == ["unit.serial"]
    assert labels == []


def test_identity_sync_returns_early_without_identity_semantics() -> None:
    from unittest.mock import MagicMock
    import uuid

    from app.services.endpoint_scrubber_semantics_identity_sync import sync_v2_endpoint_identity_from_device_mapping

    db = MagicMock()
    sync_v2_endpoint_identity_from_device_mapping(
        db,
        device_id=uuid.uuid4(),
        merged_mapping={"scrubber2": {"model": {"fieldSemantics": []}}},
        device_customer_id=uuid.uuid4(),
    )
    db.execute.assert_not_called()

