"""Layout contract for Dashboard2 demo seed (no DB required)."""

from __future__ import annotations

import uuid

from app.core.dashboard2_demo_seed import DASHBOARD2_DEMO_DASHBOARD_NAME, _demo_layout
from app.services.dashboard_validation import validate_layout_for_save


def test_demo_dashboard_name_is_stable() -> None:
    assert "Fleet" in DASHBOARD2_DEMO_DASHBOARD_NAME or "Map" in DASHBOARD2_DEMO_DASHBOARD_NAME


def test_demo_layout_passes_save_validation() -> None:
    site_id = uuid.uuid4()
    endpoint_id = uuid.uuid4()
    layout = _demo_layout(site_id=site_id, endpoint_id=endpoint_id, object_name="telemetry")
    errs = validate_layout_for_save(layout=layout, site_id=site_id, require_widgets=True)
    assert errs == []
