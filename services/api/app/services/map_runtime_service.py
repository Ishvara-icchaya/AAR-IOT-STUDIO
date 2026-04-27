"""Map runtime: eligible lists, Redis-first markers, merged detail for marker clicks."""

from __future__ import annotations

import json
import uuid
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.data_object import DataObject
from app.models.latest_device_state import LatestDeviceState
from app.services.data_object_query import as_of_timestamp
from app.services.workflow_result_query import (
    as_of_timestamp as result_object_as_of_timestamp,
    order_by_metadata_recency as order_result_objects_by_recency,
)
from app.models.workflow_result_object import WorkflowResultObject
from app.services.map_eligibility import map_eligible_data_object, map_eligible_result_object
from app.services.map_object_kpi_timescale import query_map_kpi_recent
from app.services.map_runtime_redis import (
    aggregator_stats,
    kpi_series_key_1h,
    kpi_series_key_24h,
    list_site_object_keys,
    load_kpi_series,
    load_state_json,
    parse_member,
    redis_client,
    state_key,
)


def list_eligible_map_objects(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    lat_field: str = "gps.lat",
    lon_field: str = "gps.lon",
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    stmt_do = select(DataObject).where(
        DataObject.customer_id == customer_id,
        DataObject.site_id == site_id,
    )
    for row in db.scalars(stmt_do).all():
        payload = dict(row.payload or {})
        kpi_json = dict(row.kpi_json or {})
        if not map_eligible_data_object(
            lifecycle_status=row.lifecycle_status,
            payload=payload,
            kpi_json=kpi_json,
            has_gps=row.has_gps,
            has_kpi=row.has_kpi,
            has_health=row.has_health,
            lat_field=lat_field,
            lon_field=lon_field,
        ):
            continue
        as_of = as_of_timestamp(row)
        out.append(
            {
                "source_type": "data_object",
                "source_id": str(row.id),
                "name": row.name,
                "lifecycle_status": row.lifecycle_status,
                "updated_at": as_of.isoformat() if as_of else None,
                "latest_seen_at": row.latest_seen_at.isoformat() if row.latest_seen_at else None,
            }
        )

    stmt_ro = (
        select(WorkflowResultObject)
        .where(
            WorkflowResultObject.customer_id == customer_id,
            WorkflowResultObject.site_id == site_id,
        )
        .order_by(order_result_objects_by_recency())
    )
    for row in db.scalars(stmt_ro).all():
        payload = dict(row.payload_json or {})
        if row.health_status:
            payload["health_status"] = row.health_status
        if not map_eligible_result_object(payload=payload, lat_field=lat_field, lon_field=lon_field):
            continue
        as_ro = result_object_as_of_timestamp(row)
        out.append(
            {
                "source_type": "result_object",
                "source_id": str(row.id),
                "name": row.result_object_name,
                "lifecycle_status": "published",
                "updated_at": as_ro.isoformat() if as_ro else None,
                "latest_seen_at": row.latest_seen_at.isoformat() if row.latest_seen_at else None,
            }
        )
    return out


def map_marker_to_light(marker: dict[str, Any]) -> dict[str, Any]:
    """Strip heavy fields (KPI blobs, long messages) for list/preview payloads; detail comes from /detail."""
    out: dict[str, Any] = {
        "latitude": marker.get("latitude"),
        "longitude": marker.get("longitude"),
        "display_name": marker.get("display_name"),
        "device_name": marker.get("device_name"),
        "site_name": marker.get("site_name"),
        "health_status": marker.get("health_status"),
        "blink_mode": marker.get("blink_mode"),
        "updated_at": marker.get("updated_at"),
    }
    st = marker.get("source_type")
    sid = marker.get("source_id")
    if st is not None:
        out["source_type"] = st
    if sid is not None:
        out["source_id"] = sid
    return out


def lighten_map_markers(markers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [map_marker_to_light(m) for m in markers]


def compute_map_init_from_markers(markers: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Initial center/zoom/bounds so the client can construct the map without a world-scale flash."""
    lats: list[float] = []
    lons: list[float] = []
    for m in markers:
        lat = m.get("latitude")
        lon = m.get("longitude")
        try:
            if lat is not None and lon is not None:
                lats.append(float(lat))
                lons.append(float(lon))
        except (TypeError, ValueError):
            continue
    if not lats:
        return None
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    cx = (min_lon + max_lon) / 2.0
    cy = (min_lat + max_lat) / 2.0
    span_lon = max_lon - min_lon
    span_lat = max_lat - min_lat
    if span_lon < 1e-9 and span_lat < 1e-9:
        return {"center": [cx, cy], "zoom": 12, "bounds": [[min_lon, min_lat], [max_lon, max_lat]]}
    return {
        "center": [cx, cy],
        "zoom": 10,
        "bounds": [[min_lon, min_lat], [max_lon, max_lat]],
    }


def _apply_kpi_fields(marker: dict[str, Any], kpi_fields: list[str]) -> dict[str, Any]:
    if not kpi_fields:
        return marker
    src = marker.get("kpis")
    if not isinstance(src, dict):
        src = {}
    marker = dict(marker)
    marker["kpis"] = {str(k): src.get(str(k)) for k in kpi_fields}
    return marker


def _marker_passes_device_filter(
    st_raw: dict[str, Any],
    source_type: str,
    allowed_device_ids: set[uuid.UUID] | None,
) -> bool:
    if not allowed_device_ids:
        return True
    did = st_raw.get("device_id")
    if did:
        try:
            return uuid.UUID(str(did)) in allowed_device_ids
        except ValueError:
            return False
    # No device on snapshot: hide data_object when filtering; keep result_object (may lack device)
    return source_type != "data_object"


def markers_with_redis_first(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    lat_field: str,
    lon_field: str,
    kpi_fields: list[str],
    excluded: set[str],
    title_field: str | None,
    health_field: str | None,
    allowed_device_ids: set[uuid.UUID] | None = None,
    pg_markers_fn: Callable[..., list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Try Redis snapshot markers (batched GET); fall back to PG builder (must return same marker shape)."""
    r = redis_client()
    if r is not None:
        try:
            members = list_site_object_keys(r, site_id)
            if members:
                pending: list[tuple[str, str, str]] = []
                for m in members:
                    parsed = parse_member(m)
                    if not parsed:
                        continue
                    st, sid = parsed
                    sid_s = str(sid)
                    if sid_s in excluded:
                        continue
                    pending.append((st, sid_s, state_key(customer_id, st, sid_s)))
                if pending:
                    pipe = r.pipeline()
                    for _, _, rk in pending:
                        pipe.get(rk)
                    raw_vals = pipe.execute()
                    markers: list[dict[str, Any]] = []
                    for (st, _sid_s, _), raw in zip(pending, raw_vals):
                        if not raw:
                            continue
                        try:
                            st_raw = json.loads(raw)
                        except Exception:
                            continue
                        if not isinstance(st_raw, dict):
                            continue
                        if not _marker_passes_device_filter(st_raw, st, allowed_device_ids):
                            continue
                        mk = dict(st_raw)
                        mk = _apply_kpi_fields(mk, kpi_fields)
                        markers.append(mk)
                    if markers:
                        return markers
        finally:
            try:
                r.close()
            except Exception:
                pass

    return pg_markers_fn(
        db,
        customer_id=customer_id,
        site_id=site_id,
        latf=lat_field,
        lonf=lon_field,
        kpi_fields=kpi_fields,
        excluded=excluded,
        title_field=title_field,
        health_field=health_field,
        allowed_device_ids=allowed_device_ids,
    )


def markers_manual_sources(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    included: list[dict[str, Any]],
    lat_field: str,
    lon_field: str,
    kpi_fields: list[str],
    title_field: str | None,
    health_field: str | None,
    pg_single_marker_fn,
) -> list[dict[str, Any]]:
    """Resolve one marker per included source (Redis first per id)."""
    r = redis_client()
    markers: list[dict[str, Any]] = []
    try:
        for entry in included:
            st = str(entry.get("sourceType") or entry.get("source_type") or "")
            sid_raw = entry.get("sourceId") or entry.get("source_id")
            if not st or not sid_raw:
                continue
            try:
                sid = uuid.UUID(str(sid_raw))
            except ValueError:
                continue
            sid_s = str(sid)
            if r is not None:
                st_raw = load_state_json(r, state_key(customer_id, st, sid_s))
                if st_raw:
                    mk = dict(st_raw)
                    markers.append(_apply_kpi_fields(mk, kpi_fields))
                    continue
            m = pg_single_marker_fn(
                db,
                customer_id=customer_id,
                site_id=site_id,
                source_type=st,
                source_id=sid,
                latf=lat_field,
                lonf=lon_field,
                kpi_fields=kpi_fields,
                title_field=title_field,
                health_field=health_field,
            )
            if m:
                markers.append(m)
    finally:
        if r is not None:
            try:
                r.close()
            except Exception:
                pass
    return markers


def map_marker_detail(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    source_type: str,
    source_id: uuid.UUID,
    display_field_paths: list[str] | None,
    kpi_keys: list[str] | None,
) -> dict[str, Any] | None:
    """Full detail for popup: display fields, health, KPI latest, Redis windows, Timescale samples."""
    r = redis_client()
    state: dict[str, Any] | None = None
    series_1h: dict[str, list[dict[str, Any]]] = {}
    series_24h: dict[str, list[dict[str, Any]]] = {}
    try:
        if r is not None:
            state = load_state_json(r, state_key(customer_id, source_type, str(source_id)))
            series_1h = load_kpi_series(r, kpi_series_key_1h(customer_id, source_type, str(source_id)))
            series_24h = load_kpi_series(r, kpi_series_key_24h(customer_id, source_type, str(source_id)))
    finally:
        if r is not None:
            try:
                r.close()
            except Exception:
                pass

    st_lower = source_type.lower()
    if st_lower == "data_object":
        row = db.get(DataObject, source_id)
        if not row or row.customer_id != customer_id or row.site_id != site_id:
            return None
        payload = dict(row.payload or {})
        payload["_kpi"] = dict(row.kpi_json or {})
        if row.health_status:
            payload["health_status"] = row.health_status
        merged = {**payload, **(payload.get("_kpi") or {})}
    elif st_lower == "result_object":
        row = db.get(WorkflowResultObject, source_id)
        if not row or row.customer_id != customer_id or row.site_id != site_id:
            return None
        payload = dict(row.payload_json or {})
        if row.health_status:
            payload["health_status"] = row.health_status
        merged = dict(payload)
    elif st_lower in ("latest_device_state", "device_state"):
        row = db.get(LatestDeviceState, source_id)
        if not row or row.customer_id != customer_id or row.site_id != site_id:
            return None
        payload = dict(row.display_json or {})
        payload["_kpi"] = dict(row.kpi_json or {})
        if row.health_status:
            payload["health_status"] = row.health_status
        merged = {**payload, **(payload.get("_kpi") or {})}
    else:
        return None

    from app.services.dashboard_live import _get_path

    display_fields: dict[str, Any] = {}
    paths = display_field_paths or []
    if not paths:
        df = merged.get("displayFields")
        if isinstance(df, dict):
            for k, v in list(df.items())[:24]:
                display_fields[str(k)] = v
    else:
        for p in paths:
            display_fields[str(p)] = _get_path(merged, str(p))

    k_latest: dict[str, Any] = {}
    keys = kpi_keys or []
    if not keys:
        mets = merged.get("metrics") if isinstance(merged.get("metrics"), dict) else {}
        keys = list(mets.keys())[:24] if mets else []
        if not keys:
            kj = merged.get("_kpi") if isinstance(merged.get("_kpi"), dict) else {}
            mk = kj.get("metrics") if isinstance(kj.get("metrics"), dict) else {}
            keys = list(mk.keys())[:24]

    for k in keys:
        k_latest[str(k)] = _get_path(merged, str(k))

    if st_lower in ("data_object", "result_object"):
        ts_1h = query_map_kpi_recent(
            customer_id=customer_id,
            object_kind=st_lower,
            object_id=source_id,
            hours=1.0,
            kpi_keys=keys or None,
            row_limit=120,
        )
        ts_24h = query_map_kpi_recent(
            customer_id=customer_id,
            object_kind=st_lower,
            object_id=source_id,
            hours=24.0,
            kpi_keys=keys or None,
            row_limit=240,
        )
    else:
        ts_1h, ts_24h = [], []

    health = {
        "health_status": merged.get("health_status"),
        "health_message": merged.get("health_message"),
    }

    return {
        "source_type": st_lower,
        "source_id": str(source_id),
        "site_id": str(site_id),
        "display_fields": display_fields,
        "health": health,
        "kpi_latest": k_latest,
        "kpi_windows_redis": {"1h": series_1h, "24h": series_24h},
        "kpi_history_timescale": {"1h": ts_1h, "24h": ts_24h},
        "trend": (state or {}).get("trend"),
        "redis_state": state,
    }


def internal_aggregator_visibility() -> dict[str, Any]:
    return {"stats": aggregator_stats(), "redis_key": "aar:map:aggregator:stats"}
