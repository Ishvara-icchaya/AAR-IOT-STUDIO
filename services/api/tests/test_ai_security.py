"""Site isolation helpers and raw-debug policy (minimal mocks)."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest

from app.services.ai_access_policy import apply_raw_debug_gate
from app.services.ai_execution_service import execute_plan
from app.services.ai_kpi_timescale_service import list_device_ids_for_sites
from app.services.ai_service import resolve_site_scope
from app.services.ai_sql_guard import validate_and_clamp_plan


def test_raw_debug_downgraded_for_non_admin() -> None:
    intent = {"intent": "raw_debug", "needs_llm": True, "needs_raw_access": True}
    out = apply_raw_debug_gate(intent, user_role="operator")
    assert out["intent"] == "unsupported"
    assert out["needs_llm"] is False


def test_raw_debug_kept_for_admin() -> None:
    intent = {"intent": "raw_debug", "needs_llm": False}
    out = apply_raw_debug_gate(intent, user_role="admin")
    assert out["intent"] == "raw_debug"


def test_execute_plan_blocks_when_no_authorized_sites() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    plan = {
        "dataset": "ai_alerts_recent",
        "limit": 10,
        "aggregation": "none",
        "filters": {"site_ids": []},
        "time_range": {"preset": "last_24_hours"},
        "include_payload": False,
    }
    rows, metrics = execute_plan(db, customer_id=cid, allowed_site_ids=[], plan=plan)
    assert rows == []
    assert metrics.get("reason") == "no_authorized_sites"


def test_malicious_site_filter_strips_unknown_then_uses_allowed_scope() -> None:
    """Foreign site UUIDs in filters are dropped; execution falls back to allowed sites only."""
    db = MagicMock()
    cid = uuid.uuid4()
    site_a = uuid.uuid4()
    foreign = uuid.uuid4()
    plan = validate_and_clamp_plan(
        {
            "dataset": "ai_sites",
            "limit": 20,
            "aggregation": "none",
            "filters": {"site_ids": [str(foreign)]},
            "include_payload": False,
        },
        user_role="operator",
    )
    mock_site = MagicMock()
    mock_site.id = site_a
    mock_site.name = "Site A"
    mock_site.description = None
    chain = MagicMock()
    chain.all.return_value = [mock_site]
    db.scalars.return_value = chain
    rows, metrics = execute_plan(db, customer_id=cid, allowed_site_ids=[site_a], plan=plan)
    assert metrics.get("rows_returned") == 1
    assert rows[0]["id"] == str(site_a)
    assert db.scalars.call_count == 1


def test_list_device_ids_empty_when_no_sites() -> None:
    db = MagicMock()
    assert list_device_ids_for_sites(db, customer_id=uuid.uuid4(), site_ids=[]) == []


def test_resolve_site_scope_operator_subset() -> None:
    db = MagicMock()
    user = MagicMock()
    user.is_superuser = False
    user.role = "operator"
    user.customer_id = uuid.uuid4()
    s1, s2 = uuid.uuid4(), uuid.uuid4()
    link = MagicMock()
    link.site_id = s1
    user.site_links = [link]

    out = resolve_site_scope(db, user, None)
    assert out == [s1]

    out2 = resolve_site_scope(db, user, [s1])
    assert out2 == [s1]

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        resolve_site_scope(db, user, [s2])
    assert ei.value.status_code == 403


def test_resolve_site_scope_admin_all_customer_sites() -> None:
    db = MagicMock()
    user = MagicMock()
    user.is_superuser = False
    user.role = "admin"
    user.customer_id = uuid.uuid4()
    user.site_links = []
    s1 = uuid.uuid4()
    chain = MagicMock()
    chain.all.return_value = [s1]
    db.scalars.return_value = chain

    out = resolve_site_scope(db, user, None)
    assert out == [s1]
