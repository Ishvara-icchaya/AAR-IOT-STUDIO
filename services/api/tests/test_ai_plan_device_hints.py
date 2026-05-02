"""Tests for device name hints in Enterprise AI KPI plans."""

from app.services.ai_plan_device_hints import extract_device_name_hint


def test_extract_device_hint_end_of_question():
    assert extract_device_name_hint("What are the KPIs for LG-Berger") == "LG-Berger"
    assert extract_device_name_hint("What are the KPI's for LG-Berger?") == "LG-Berger"


def test_extract_device_hint_empty():
    assert extract_device_name_hint("") is None
    assert extract_device_name_hint("   ") is None
