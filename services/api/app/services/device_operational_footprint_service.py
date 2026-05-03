"""Load footprint context from DB and build API payloads (operational lineage)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.operational_footprint import (
    OperationalFootprintContext,
    derive_recommendation,
    evaluate_status,
)
from app.models.dashboard import Dashboard
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.device_endpoint import DeviceEndpoint
from app.models.device_object import DeviceObject
from app.models.endpoint import Endpoint
from app.models.resolved_device import ResolvedDevice
from app.services.dashboard_dependency_service import _layout_refs

log = logging.getLogger(__name__)


def _last_ingested_at(device: Device, ep: DeviceEndpoint | None) -> datetime | None:
    if ep is not None and ep.last_payload_at is not None:
        return ep.last_payload_at
    return device.last_seen_at


def _expected_frequency_sec(device: Device, ep: DeviceEndpoint | None) -> int:
    if device.expected_interval_seconds and device.expected_interval_seconds > 0:
        return int(device.expected_interval_seconds)
    if ep is not None and ep.polling_interval_seconds and ep.polling_interval_seconds > 0:
        return int(ep.polling_interval_seconds)
    return 60


def _pipeline_error(ep: DeviceEndpoint | None) -> bool:
    if ep is None:
        return False
    if (ep.activation_status or "").strip().lower() == "error":
        return True
    if ep.last_error and str(ep.last_error).strip():
        return True
    return False


def _scrubber_configured(device_object: DeviceObject | None) -> bool:
    if device_object is None:
        return False
    m = device_object.mapping if isinstance(device_object.mapping, dict) else {}
    ss = m.get("scrubberStudio")
    if not isinstance(ss, dict):
        return False
    return bool(ss.get("frozenPipelineVersion") or ss.get("frozen_pipeline_version"))


def _resolved_id_for_endpoint(db: Session, endpoint_row: Endpoint | None) -> str | None:
    if endpoint_row is None:
        return None
    rid = db.scalar(
        select(ResolvedDevice.id).where(ResolvedDevice.endpoint_id == endpoint_row.id).limit(1)
    )
    return str(rid) if rid else None


def load_operational_footprint_context(
    db: Session,
    device: Device,
    *,
    endpoint: DeviceEndpoint | None,
    endpoint_row: Endpoint | None,
    device_object: DeviceObject | None,
    dashboard_association_count: int = 0,
) -> OperationalFootprintContext:
    ep = endpoint
    rid = _resolved_id_for_endpoint(db, endpoint_row) if endpoint_row else None
    return OperationalFootprintContext(
        device_id=str(device.id),
        created_at=device.created_at,
        endpoint_id=str(ep.id) if ep else None,
        activation_status=ep.activation_status if ep else None,
        resolved_device_id=rid,
        last_ingested_at=_last_ingested_at(device, ep),
        expected_frequency_sec=_expected_frequency_sec(device, ep),
        pipeline_error=_pipeline_error(ep),
        scrubber_configured=_scrubber_configured(device_object),
        dashboard_association_count=int(dashboard_association_count),
    )


def batch_dashboard_association_counts(
    db: Session, *, customer_id: uuid.UUID, device_ids: set[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Count dashboards whose layout references each device (same semantics as ``dashboards_referencing_device``)."""
    if not device_ids:
        return {}
    counts: dict[uuid.UUID, int] = {did: 0 for did in device_ids}
    dashboards = db.scalars(select(Dashboard).where(Dashboard.customer_id == customer_id)).all()
    for dash in dashboards:
        layout = dict(dash.layout or {})
        data_ids, _, dev_ids_from_layout = _layout_refs(db, layout=layout)
        referenced: set[uuid.UUID] = set(dev_ids_from_layout)
        for doid in data_ids:
            row = db.get(DataObject, doid)
            if row and row.device_id in device_ids:
                referenced.add(row.device_id)
        for dev_id in referenced & device_ids:
            counts[dev_id] += 1
    return counts


def batch_load_footprint_sidecars(
    db: Session, devices: list[Device]
) -> tuple[dict[uuid.UUID, Endpoint], dict[uuid.UUID, DeviceObject]]:
    """Return (endpoint_by_device_endpoint_id, device_object_by_device_id) for the given devices."""
    dev_ep_ids: list[uuid.UUID] = []
    dev_ids: list[uuid.UUID] = []
    for d in devices:
        dev_ids.append(d.id)
        if d.endpoint is not None:
            dev_ep_ids.append(d.endpoint.id)
    ep_by_de: dict[uuid.UUID, Endpoint] = {}
    if dev_ep_ids:
        rows = db.scalars(select(Endpoint).where(Endpoint.device_endpoint_id.in_(dev_ep_ids))).all()
        for er in rows:
            if er.device_endpoint_id:
                ep_by_de[er.device_endpoint_id] = er
    dobjs: dict[uuid.UUID, DeviceObject] = {}
    if dev_ids:
        objs = db.scalars(select(DeviceObject).where(DeviceObject.device_id.in_(dev_ids))).all()
        for o in objs:
            dobjs[o.device_id] = o
    return ep_by_de, dobjs


def footprint_context_for_device(
    db: Session,
    device: Device,
    *,
    ep_by_de: dict[uuid.UUID, Endpoint],
    dobjs: dict[uuid.UUID, DeviceObject],
    dashboard_counts: dict[uuid.UUID, int] | None = None,
) -> OperationalFootprintContext:
    ep = device.endpoint
    endpoint_row = ep_by_de.get(ep.id) if ep else None
    dobj = dobjs.get(device.id)
    dash_n = 0
    if dashboard_counts and device.id in dashboard_counts:
        dash_n = dashboard_counts[device.id]
    return load_operational_footprint_context(
        db,
        device,
        endpoint=ep,
        endpoint_row=endpoint_row,
        device_object=dobj,
        dashboard_association_count=dash_n,
    )


def evaluate_footprint_for_device(
    db: Session,
    device: Device,
    *,
    ep_by_de: dict[uuid.UUID, Endpoint],
    dobjs: dict[uuid.UUID, DeviceObject],
    dashboard_counts: dict[uuid.UUID, int] | None = None,
    now: datetime | None = None,
) -> tuple[str, str, str]:
    """Return (status, recommendation_code, recommendation_message)."""
    ctx = footprint_context_for_device(db, device, ep_by_de=ep_by_de, dobjs=dobjs, dashboard_counts=dashboard_counts)
    st = evaluate_status(ctx, now=now)
    code, msg = derive_recommendation(ctx, st, now=now)
    return st, code, msg


def build_device_footprint_payload(
    db: Session,
    device: Device,
    *,
    ep_by_de: dict[uuid.UUID, Endpoint],
    dobjs: dict[uuid.UUID, DeviceObject],
    dashboard_counts: dict[uuid.UUID, int] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Response body for GET /devices/{id}/footprint (v1 minimal shape)."""
    n = now or datetime.now(timezone.utc)
    ctx = footprint_context_for_device(db, device, ep_by_de=ep_by_de, dobjs=dobjs, dashboard_counts=dashboard_counts)
    st = evaluate_status(ctx, now=n)
    code, msg = derive_recommendation(ctx, st, now=n)
    ep = device.endpoint
    endpoint_row = ep_by_de.get(ep.id) if ep else None
    return {
        "device": {
            "device_id": str(device.id),
            "resolved_device_id": ctx.resolved_device_id,
            "site_id": str(device.site_id),
            "activation_status": ep.activation_status if ep else None,
        },
        "endpoint": (
            {
                "endpoint_id": str(ep.id),
                "name": device.name,
                "status": ep.activation_status if ep else None,
                "expected_frequency_sec": ctx.expected_frequency_sec,
            }
            if ep
            else None
        ),
        "ingestion": {
            "last_ingested_at": ctx.last_ingested_at.isoformat() if ctx.last_ingested_at else None,
            "ingest_age_sec": int((n - ctx.last_ingested_at).total_seconds()) if ctx.last_ingested_at else None,
            "expected_frequency_sec": ctx.expected_frequency_sec,
            "stale_after_sec": max(3 * max(ctx.expected_frequency_sec, 1), 60),
        },
        "scrubber": {
            "associated": ctx.scrubber_configured,
            "last_output_at": None,
            "status": "ok" if ctx.scrubber_configured else "not_configured",
        },
        "workflow": {"associated": False, "workflows": []},
        "dashboard": {
            "count": ctx.dashboard_association_count,
            "dashboards": [],
        },
        "trends": {
            "device_trend_available": False,
            "endpoint_rollup_available": False,
            "records_1h": None,
            "records_24h": None,
        },
        "status": st,
        "recommendation": {"code": code, "message": msg},
    }
