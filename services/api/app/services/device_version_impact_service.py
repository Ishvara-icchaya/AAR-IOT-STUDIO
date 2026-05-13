"""Phase 9 — static compare / impact: field diff vs prior active row + graph blast radius."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.dashboard import Dashboard
from app.models.data_object import DataObject
from app.models.device import Device
from app.models.device_object import DeviceObject
from app.models.device_version import DeviceVersion
from app.schemas.dashboard_layout import iter_widgets
from app.services.dashboard_validation import _bget, _cget
from app.services.device_operational_footprint_service import (
    batch_dashboard_references,
    batch_load_footprint_sidecars,
    workflows_for_device,
)

_DIFF_FIELDS: tuple[str, ...] = (
    "version_label",
    "firmware_version",
    "hardware_version",
    "config_version",
    "endpoint_version",
    "scrubber_version",
    "schema_version",
    "manifest_hash",
    "firmware_channel",
    "routing_lane",
    "compatibility",
    "status",
    "version_source",
)


def _field_val(row: DeviceVersion | None, name: str) -> str | None:
    if row is None:
        return None
    v = getattr(row, name, None)
    if v is None:
        return None
    return str(v)


def schema_diff_engine(baseline: DeviceVersion | None, candidate: DeviceVersion) -> list[dict[str, Any]]:
    """Pairwise diff for immutable snapshot columns (Phase 9)."""
    out: list[dict[str, Any]] = []
    for field in _DIFF_FIELDS:
        b = _field_val(baseline, field)
        c = _field_val(candidate, field)
        changed = b != c
        out.append({"field": field, "baseline": b, "candidate": c, "changed": changed})
    return out


def _parse_uuid_val(raw: Any) -> uuid.UUID | None:
    if raw is None:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        return None


def _catalog_attribute_ids_from_device_object(dobj: DeviceObject | None) -> set[str]:
    if dobj is None or not isinstance(dobj.mapping, dict):
        return set()
    m = dobj.mapping
    fc = m.get("fieldCatalog") if isinstance(m.get("fieldCatalog"), dict) else None
    if fc is None and isinstance(m.get("field_catalog"), dict):
        fc = m["field_catalog"]
    if not isinstance(fc, dict):
        return set()
    fields = fc.get("fields") if isinstance(fc.get("fields"), list) else []
    out: set[str] = set()
    for f in fields:
        if not isinstance(f, dict):
            continue
        aid = f.get("attributeId")
        if aid is None:
            aid = f.get("attribute_id")
        if aid is not None and str(aid).strip():
            out.add(str(aid).strip())
    return out


def _collect_attr_strings_from_mapping(obj: Any, keys: tuple[str, ...]) -> list[str]:
    if not isinstance(obj, dict):
        return []
    found: list[str] = []
    for k in keys:
        v = obj.get(k)
        if v is not None and str(v).strip():
            found.append(str(v).strip())
    return found


def _extract_widget_attribute_refs(w: dict[str, Any]) -> list[str]:
    """Best-effort attribute / metric paths referenced by a dashboard widget."""
    b = w.get("binding") if isinstance(w.get("binding"), dict) else {}
    c = w.get("config") if isinstance(w.get("config"), dict) else {}
    wtype = str(w.get("type") or "")
    refs: list[str] = []

    refs.extend(_collect_attr_strings_from_mapping(b, ("attribute_id", "attributeId")))
    m = _bget(b, "metric", "metric")
    if m is not None and str(m).strip() and wtype == "kpi":
        refs.append(str(m).strip())

    ya = _cget(c, "y_axis_attribute", "yAxisAttribute")
    if ya is not None and str(ya).strip():
        refs.append(str(ya).strip())
    xa = _cget(c, "x_axis_attribute", "xAxisAttribute")
    if xa is not None and str(xa).strip():
        refs.append(str(xa).strip())

    for key in ("fields", "columns", "metrics", "series"):
        block = c.get(key)
        if not isinstance(block, list):
            continue
        for col in block:
            if not isinstance(col, dict):
                continue
            refs.extend(_collect_attr_strings_from_mapping(col, ("attribute_id", "attributeId", "field", "path", "metric")))

    seen: set[str] = set()
    out: list[str] = []
    for r in refs:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def _widget_binds_device_data_object(db: Session, w: dict[str, Any], device_id: uuid.UUID) -> bool:
    b = w.get("binding") if isinstance(w.get("binding"), dict) else {}
    st = _bget(b, "source_type", "sourceType")
    sid = _parse_uuid_val(_bget(b, "source_id", "sourceId"))
    if st != "data_object" or sid is None:
        return False
    row = db.get(DataObject, sid)
    return bool(row and row.device_id == device_id)


def build_widget_attribute_impact_rows(
    db: Session,
    *,
    device: Device,
    dash_summaries: list[dict[str, Any]],
    catalog_ids: set[str],
    schema_version_changed: bool,
) -> list[dict[str, Any]]:
    """Per-widget attribute/metric refs for dashboards that reference this device (data_object bindings)."""
    if not dash_summaries:
        return []
    ids = [_parse_uuid_val(d.get("id")) for d in dash_summaries]
    id_list = [x for x in ids if x is not None]
    if not id_list:
        return []
    rows_out: list[dict[str, Any]] = []
    dashboards = list(db.scalars(select(Dashboard).where(Dashboard.id.in_(id_list))).all())
    by_id = {d.id: d for d in dashboards}
    for dsum in dash_summaries:
        did = _parse_uuid_val(dsum.get("id"))
        if did is None or did not in by_id:
            continue
        dash = by_id[did]
        layout = dict(dash.layout or {})
        for w in iter_widgets(layout):
            if not isinstance(w, dict):
                continue
            if not _widget_binds_device_data_object(db, w, device.id):
                continue
            wtype = str(w.get("type") or "")
            wid = w.get("widgetId") or w.get("widget_id")
            title = str(w.get("title") or "")
            attr_refs = _extract_widget_attribute_refs(w)
            missing = sorted({a for a in attr_refs if a not in catalog_ids})
            review_recommended = bool(schema_version_changed or missing)
            rows_out.append(
                {
                    "dashboard_id": str(dash.id),
                    "dashboard_name": dash.name,
                    "widget_id": str(wid) if wid is not None else None,
                    "widget_type": wtype or None,
                    "widget_title": title,
                    "attribute_ids": attr_refs,
                    "missing_from_catalog": missing,
                    "review_recommended": review_recommended,
                }
            )
    return rows_out


def resolve_previous_active_baseline(db: Session, candidate: DeviceVersion) -> DeviceVersion | None:
    """Baseline = latest prior ``active`` row for the same device (strictly before candidate cut time)."""
    return db.scalars(
        select(DeviceVersion)
        .where(
            DeviceVersion.device_id == candidate.device_id,
            DeviceVersion.status == "active",
            DeviceVersion.created_at < candidate.created_at,
        )
        .order_by(DeviceVersion.created_at.desc(), DeviceVersion.id.desc())
        .limit(1)
    ).first()


def list_device_version_snapshots(db: Session, device_id: uuid.UUID) -> list[DeviceVersion]:
    return list(
        db.scalars(
            select(DeviceVersion)
            .where(DeviceVersion.device_id == device_id)
            .order_by(DeviceVersion.created_at.desc(), DeviceVersion.id.desc())
        ).all()
    )


def build_static_impact_payload(
    db: Session,
    *,
    customer_id: uuid.UUID,
    device: Device,
    candidate: DeviceVersion,
) -> dict[str, Any]:
    baseline = resolve_previous_active_baseline(db, candidate)
    field_diff = schema_diff_engine(baseline, candidate)
    ep_by_de, dobjs = batch_load_footprint_sidecars(db, [device])
    wf_rows = workflows_for_device(db, customer_id=customer_id, device=device, ep_by_de=ep_by_de)
    dash_rows = batch_dashboard_references(db, customer_id=customer_id, device_ids={device.id})[device.id]
    dobj = dobjs.get(device.id)
    catalog_ids = _catalog_attribute_ids_from_device_object(dobj)
    b_sv = _field_val(baseline, "schema_version")
    c_sv = _field_val(candidate, "schema_version")
    schema_version_changed = b_sv != c_sv

    widget_rows = build_widget_attribute_impact_rows(
        db,
        device=device,
        dash_summaries=dash_rows,
        catalog_ids=catalog_ids,
        schema_version_changed=schema_version_changed,
    )

    notes: list[dict[str, Any]] = []
    if b_sv != c_sv and dash_rows:
        notes.append(
            {
                "code": "schema_version_delta",
                "message": (
                    "schema_version differs from the prior active baseline; dashboards that bind "
                    "via schema_version + attribute_id may need review (static graph list below)."
                ),
                "dashboard_count": len(dash_rows),
            }
        )
    risky_widgets = [r for r in widget_rows if r.get("review_recommended")]
    if risky_widgets:
        notes.append(
            {
                "code": "widget_attribute_catalog_gap",
                "message": (
                    f"{len(risky_widgets)} dashboard widget(s) reference attribute/metric paths that are not in the "
                    "current device field catalog and/or coincide with a schema_version change — review before promote."
                ),
                "dashboard_count": len({r['dashboard_id'] for r in risky_widgets}),
            }
        )

    return {
        "device_id": str(device.id),
        "candidate_id": str(candidate.id),
        "baseline_id": str(baseline.id) if baseline else None,
        "field_diff": field_diff,
        "workflows": wf_rows,
        "dashboards": dash_rows,
        "catalog_attribute_ids": sorted(catalog_ids),
        "widget_attribute_impact": widget_rows,
        "notes": notes,
    }


def list_ota_target_history_for_device(
    db: Session,
    *,
    customer_id: uuid.UUID,
    device_id: uuid.UUID,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Recent OTA campaign targets for this device (Phase 8 OTA History tab)."""
    from app.models.ota_campaign import OtaCampaign, OtaCampaignTarget

    rows = db.execute(
        select(OtaCampaignTarget, OtaCampaign)
        .join(OtaCampaign, OtaCampaign.id == OtaCampaignTarget.campaign_id)
        .where(
            OtaCampaignTarget.device_id == device_id,
            OtaCampaign.customer_id == customer_id,
        )
        .order_by(OtaCampaignTarget.completed_at.desc().nulls_last(), OtaCampaignTarget.id.desc())
        .limit(limit)
    ).all()
    out: list[dict[str, Any]] = []
    for tgt, camp in rows:
        out.append(
            {
                "target_id": str(tgt.id),
                "campaign_id": str(camp.id),
                "campaign_name": camp.name,
                "campaign_status": camp.status,
                "target_status": tgt.status,
                "target_firmware_version": tgt.target_firmware_version,
                "completed_at": tgt.completed_at,
            }
        )
    return out
