"""Idempotent demo dashboard for Dashboard2 fleet/map review (v1 layout stored in dashboards.layout)."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dashboard_status import DASHBOARD_DRAFT
from app.models.dashboard import Dashboard
from app.models.endpoint import Endpoint
from app.models.latest_device_state import LatestDeviceState
from app.models.site import Site
from app.models.user import User
from app.services.dashboard_validation import validate_layout_for_save

log = logging.getLogger(__name__)

DASHBOARD2_DEMO_DASHBOARD_NAME = "Demo — Fleet / Map (Dashboard2)"


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _demo_layout(*, site_id: uuid.UUID, endpoint_id: uuid.UUID, object_name: str) -> dict[str, Any]:
    """Legacy v1 layout rows (API validation + iter_widgets). Map row: single column span 12."""
    bind = {
        "sourceType": "resolved_device_collection",
        "siteId": str(site_id),
        "endpointId": str(endpoint_id),
        "objectName": object_name,
    }
    map_bind = {
        **bind,
        "latitudeField": "lat",
        "longitudeField": "lon",
    }
    return {
        "version": 1,
        "rows": [
            {
                "rowId": "demo-r1",
                "columns": [
                    {
                        "columnId": "demo-c1",
                        "span": 4,
                        "widget": {
                            "widgetId": "demo-kpi-total",
                            "type": "kpi",
                            "title": "Devices (summary)",
                            "binding": {**bind, "metric": "total"},
                            "config": {"metric": "total"},
                        },
                    },
                    {
                        "columnId": "demo-c2",
                        "span": 4,
                        "widget": {
                            "widgetId": "demo-health",
                            "type": "health_summary",
                            "title": "Health mix",
                            "binding": {},
                            "config": {},
                        },
                    },
                    {
                        "columnId": "demo-c3",
                        "span": 4,
                        "widget": {
                            "widgetId": "demo-intro",
                            "type": "text",
                            "title": "About",
                            "binding": {},
                            "config": {
                                "text": "Seeded Dashboard2 demo: endpoint-group KPI, map, and table. "
                                "Requires latest_device_state rows for this site/endpoint/object."
                            },
                        },
                    },
                ],
            },
            {
                "rowId": "demo-r2",
                "columns": [
                    {
                        "columnId": "demo-map",
                        "span": 12,
                        "widget": {
                            "widgetId": "demo-map",
                            "type": "map",
                            "title": "Fleet map",
                            "binding": map_bind,
                            "config": {"autoIncludeGpsObjects": True},
                        },
                    },
                ],
            },
            {
                "rowId": "demo-r3",
                "columns": [
                    {
                        "columnId": "demo-table",
                        "span": 12,
                        "widget": {
                            "widgetId": "demo-table",
                            "type": "table",
                            "title": "Latest devices",
                            "binding": bind,
                            "config": {},
                        },
                    },
                ],
            },
        ],
    }


def ensure_dashboard2_demo_dashboard(db: Session) -> None:
    """Create demo dashboard when a site + endpoint (+ optional LDS) exist; no-op if duplicate name."""
    site = db.scalar(select(Site).order_by(Site.created_at.asc()).limit(1))
    if not site:
        log.debug("dashboard2 demo seed skipped: no site")
        return

    existing = db.scalar(
        select(Dashboard).where(Dashboard.customer_id == site.customer_id, Dashboard.name == DASHBOARD2_DEMO_DASHBOARD_NAME).limit(1)
    )
    if existing:
        return

    ep = db.scalar(select(Endpoint).where(Endpoint.site_id == site.id).order_by(Endpoint.created_at.asc()).limit(1))
    if not ep:
        log.debug("dashboard2 demo seed skipped: no endpoint for site %s", site.id)
        return

    lds = db.scalar(
        select(LatestDeviceState)
        .where(
            LatestDeviceState.site_id == site.id,
            LatestDeviceState.endpoint_id == ep.id,
        )
        .order_by(LatestDeviceState.updated_at.desc())
        .limit(1)
    )
    object_name = str(lds.object_name) if lds else "telemetry"

    layout = _demo_layout(site_id=site.id, endpoint_id=ep.id, object_name=object_name)
    errs = validate_layout_for_save(layout=layout, site_id=site.id, require_widgets=True)
    if errs:
        log.warning("dashboard2 demo seed skipped: layout validation failed: %s", errs)
        return

    creator = db.scalar(select(User).where(User.customer_id == site.customer_id, User.is_active.is_(True)).limit(1))

    d = Dashboard(
        customer_id=site.customer_id,
        site_id=site.id,
        name=DASHBOARD2_DEMO_DASHBOARD_NAME,
        description="Auto-seeded for Dashboard2 review (fleet / map / endpoint group).",
        layout=layout,
        status=DASHBOARD_DRAFT,
        created_by=creator.id if creator else None,
    )
    db.add(d)
    db.commit()
    log.info(
        "Seeded Dashboard2 demo dashboard id=%s site_id=%s endpoint_id=%s object_name=%s",
        d.id,
        site.id,
        ep.id,
        object_name,
    )
