"""Trend metric allowlist (site + global)."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import app.services.trend_metrics_policy as tmp


def test_filter_metric_keys_site_allowlist() -> None:
    db = MagicMock()
    site = MagicMock()
    site.trend_metric_allowlist = "a, b"
    db.get.return_value = site
    sid = uuid.uuid4()
    assert tmp.filter_metric_keys_for_site(db, site_id=sid, keys=["a", "c", "b"]) == ["a", "b"]


def test_filter_metric_keys_site_empty_string_denies_all() -> None:
    db = MagicMock()
    site = MagicMock()
    site.trend_metric_allowlist = ""
    db.get.return_value = site
    sid = uuid.uuid4()
    assert tmp.filter_metric_keys_for_site(db, site_id=sid, keys=["a", "b"]) == []


def test_filter_metric_keys_global_fallback() -> None:
    db = MagicMock()
    db.get.return_value = None
    sid = uuid.uuid4()
    with patch.object(tmp.settings, "trend_metric_allowlist", "speed, temp"):
        assert tmp.filter_metric_keys_for_site(db, site_id=sid, keys=["speed", "other"]) == ["speed"]


def test_filter_metric_keys_no_gate_when_unset() -> None:
    db = MagicMock()
    db.get.return_value = None
    sid = uuid.uuid4()
    with patch.object(tmp.settings, "trend_metric_allowlist", ""):
        assert tmp.filter_metric_keys_for_site(db, site_id=sid, keys=["x", "y"]) == ["x", "y"]
