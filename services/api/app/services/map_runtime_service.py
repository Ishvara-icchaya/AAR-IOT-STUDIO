"""Map runtime: eligible lists, Redis-first markers, merged detail for marker clicks."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Callable

log = logging.getLogger(__name__)

# Batched GETs per pipeline.execute to avoid oversized single writes (Redis socket timeouts).
_REDIS_MARKER_GET_CHUNK = 200

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.data_object import DataObject
from app.models.latest_device_state import LatestDeviceState
from app.models.resolved_device import ResolvedDevice
from app.services.data_object_query import as_of_timestamp
from app.services.workflow_result_query import (
    as_of_timestamp as result_object_as_of_timestamp,
    order_by_metadata_recency as order_result_objects_by_recency,
)
from app.models.workflow_result_object import WorkflowResultObject
from app.services.map_eligibility import (
    lat_lon_from_lds_row_fragments,
    map_eligible_data_object,
    map_eligible_result_object,
)
from app.services.device_version_read_context import (
    LiveReadLane,
    candidate_latest_row,
    governance_dict,
    resolve_operational_read_for_resolved_device,
)
from app.services.map_object_kpi_timescale import query_map_kpi_recent_pair
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
    stmt_lds = select(LatestDeviceState).where(
        LatestDeviceState.customer_id == customer_id,
        LatestDeviceState.site_id == site_id,
    )
    for row in db.scalars(stmt_lds).all():
        lat_f, lon_f = lat_lon_from_lds_row_fragments(
            location_json=row.location_json if isinstance(row.location_json, dict) else None,
            display_json=row.display_json if isinstance(row.display_json, dict) else None,
            kpi_json=row.kpi_json if isinstance(row.kpi_json, dict) else None,
        )
        if lat_f is None or lon_f is None:
            continue
        label = ""
        disp = row.display_json if isinstance(row.display_json, dict) else {}
        if isinstance(disp.get("device_label"), str):
            label = disp["device_label"]
        name = label or str(row.object_name or "device")
        out.append(
            {
                "source_type": "latest_device_state",
                "source_id": str(row.id),
                "name": name,
                "lifecycle_status": row.lifecycle_status,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "latest_seen_at": row.last_event_ts.isoformat() if row.last_event_ts else None,
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


def _stable_hue_deg(token: str) -> int:
    h = 2166136261
    for ch in token:
        h = (h ^ ord(ch)) * 16777619 & 0xFFFFFFFF
    return int(h % 360)


def _marker_hue(marker: dict[str, Any]) -> int:
    gix = marker.get("marker_group_index")
    base = str(
        marker.get("resolved_device_id")
        or marker.get("device_id")
        or marker.get("endpoint_id")
        or marker.get("source_id")
        or marker.get("display_name")
        or "x"
    )
    hue = _stable_hue_deg(base)
    if gix is not None:
        try:
            hue = (int(gix) * 37 + hue) % 360
        except (TypeError, ValueError):
            pass
    return hue


def aggregate_data_object_markers_by_device(markers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One map marker per physical device when multiple data_object rows share device_id (fleet feeds)."""
    from collections import defaultdict

    passthrough: list[dict[str, Any]] = []
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in markers:
        if m.get("source_type") != "data_object":
            passthrough.append(m)
            continue
        did = m.get("device_id")
        if not did:
            passthrough.append(m)
            continue
        buckets[str(did)].append(m)
    merged: list[dict[str, Any]] = []
    for _did, group in buckets.items():
        if len(group) == 1:
            merged.append(group[0])
            continue
        lats = [float(x["latitude"]) for x in group]
        lons = [float(x["longitude"]) for x in group]
        newest = max(group, key=lambda x: str(x.get("updated_at") or x.get("latest_seen_at") or ""))
        m2 = dict(newest)
        m2["latitude"] = sum(lats) / len(lats)
        m2["longitude"] = sum(lons) / len(lons)
        base_name = m2.get("device_name") or m2.get("display_name") or "Device"
        m2["display_name"] = f"{base_name} ({len(group)} feeds)"
        merged.append(m2)
    return merged + passthrough


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
        "marker_hue": _marker_hue(marker),
    }
    st = marker.get("source_type")
    sid = marker.get("source_id")
    if st is not None:
        out["source_type"] = st
    if sid is not None:
        out["source_id"] = sid
    eid = marker.get("endpoint_id")
    if eid is not None:
        out["endpoint_id"] = str(eid)
    rd = marker.get("resolved_device_id")
    if rd is not None:
        out["resolved_device_id"] = str(rd)
    if marker.get("heading_deg") is not None:
        out["heading_deg"] = marker.get("heading_deg")
    if marker.get("mobility_type") is not None:
        out["mobility_type"] = marker.get("mobility_type")
    if marker.get("has_heading") is not None:
        out["has_heading"] = marker.get("has_heading")
    if marker.get("expected_frequency_sec") is not None:
        out["expected_frequency_sec"] = marker.get("expected_frequency_sec")
    did = marker.get("device_id")
    if did is not None:
        out["device_id"] = str(did)
    edv = marker.get("effective_device_version_id")
    if edv is not None:
        out["effective_device_version_id"] = str(edv)
    pdv = marker.get("pinned_device_version_id")
    if pdv is not None:
        out["pinned_device_version_id"] = str(pdv)
    rlane = marker.get("read_lane")
    if rlane is not None:
        out["read_lane"] = str(rlane)
    gix_out = marker.get("marker_group_index")
    if gix_out is None:
        gix_out = marker.get("markerGroupIndex")
    if gix_out is not None:
        try:
            out["marker_group_index"] = int(gix_out)
        except (TypeError, ValueError):
            pass
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


def _marker_identity_key(marker: dict[str, Any]) -> tuple[str, str]:
    return (str(marker.get("source_type") or "").lower(), str(marker.get("source_id") or ""))


def _merge_pg_markers_over_redis(
    pg_markers: list[dict[str, Any]],
    redis_markers: list[dict[str, Any]],
    kpi_fields: list[str],
) -> list[dict[str, Any]]:
    """Prefer DB-built markers; keep Redis-only entries (e.g. not yet visible in PG) as fallback.

    Redis snapshots are written on create-style events and are not refreshed on every row update,
    so returning Redis alone would show stale positions while ``latest_device_state`` / payloads are new.
    """
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for m in pg_markers:
        k = _marker_identity_key(m)
        seen.add(k)
        out.append(_apply_kpi_fields(dict(m), kpi_fields))
    for m in redis_markers:
        k = _marker_identity_key(m)
        if k in seen:
            continue
        out.append(_apply_kpi_fields(dict(m), kpi_fields))
    return out


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
    pg_light: bool = False,
    pin_device_version_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    """Load Postgres markers, then overlay Redis-only keys.

    Redis holds aggregator snapshots (often create-time); PG reflects current payloads and
    ``latest_device_state``. Returning Redis alone caused stale map positions after ingest updates.
    """
    pg = pg_markers_fn(
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
        light=pg_light,
        pin_device_version_id=pin_device_version_id,
    )
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
                    if len(pending) > 400:
                        log.warning(
                            "map redis overlay skipped (too many site members=%s); using Postgres only site_id=%s",
                            len(pending),
                            site_id,
                        )
                        return pg
                    redis_markers: list[dict[str, Any]] = []
                    try:
                        for off in range(0, len(pending), _REDIS_MARKER_GET_CHUNK):
                            chunk = pending[off : off + _REDIS_MARKER_GET_CHUNK]
                            pipe = r.pipeline()
                            for _, _, rk in chunk:
                                pipe.get(rk)
                            raw_vals = pipe.execute()
                            for (st, _sid_s, _), raw in zip(chunk, raw_vals):
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
                                redis_markers.append(dict(st_raw))
                    except Exception as exc:
                        log.warning(
                            "map redis marker batch read failed site_id=%s pending=%s: %s",
                            site_id,
                            len(pending),
                            exc,
                        )
                        return pg
                    if redis_markers:
                        return _merge_pg_markers_over_redis(pg, redis_markers, kpi_fields)
        finally:
            try:
                r.close()
            except Exception:
                pass

    return pg


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
    pin_device_version_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    """Resolve one marker per included source (Postgres authoritative; Redis only if PG has no marker)."""
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
                pin_device_version_id=pin_device_version_id,
            )
            gix = entry.get("marker_group_index")
            if gix is None:
                gix = entry.get("markerGroupIndex")
            if m:
                if gix is not None:
                    try:
                        m["marker_group_index"] = int(gix)
                    except (TypeError, ValueError):
                        pass
                markers.append(_apply_kpi_fields(dict(m), kpi_fields))
                continue
            if r is not None:
                st_raw = load_state_json(r, state_key(customer_id, st, sid_s))
                if st_raw:
                    mk = dict(st_raw)
                    if gix is not None:
                        try:
                            mk["marker_group_index"] = int(gix)
                        except (TypeError, ValueError):
                            pass
                    markers.append(_apply_kpi_fields(mk, kpi_fields))
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
    trend_scope: str | None = None,
    include_timescale_history: bool = False,
    device_version_id: uuid.UUID | None = None,
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
    read_ctx_lds = None
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
        try:
            read_ctx_lds = resolve_operational_read_for_resolved_device(
                db,
                customer_id=customer_id,
                resolved_device_id=row.resolved_device_id,
                explicit_device_version_id=device_version_id,
            )
        except (LookupError, PermissionError):
            return None
        if device_version_id is not None and read_ctx_lds.live_read_lane == LiveReadLane.unavailable:
            return None
        if read_ctx_lds.live_read_lane == LiveReadLane.candidate_lds and device_version_id is not None:
            crow = candidate_latest_row(
                db, resolved_device_id=row.resolved_device_id, device_version_id=device_version_id
            )
            if not crow:
                return None
            payload = dict(crow.display_json or {})
            payload["_kpi"] = dict(crow.kpi_json or {})
            hj = crow.health_json if isinstance(crow.health_json, dict) else {}
            hs = hj.get("health_status") if isinstance(hj.get("health_status"), str) else None
            if hs:
                payload["health_status"] = hs
        else:
            payload = dict(row.display_json or {})
            payload["_kpi"] = dict(row.kpi_json or {})
            if row.health_status:
                payload["health_status"] = row.health_status
        merged = {**payload, **(payload.get("_kpi") or {})}
    else:
        return None

    from app.services.dashboard_live import _get_path, _resolve_kpi_metric_value

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

    from app.services.trend_metrics_policy import filter_metric_keys_for_site

    keys = filter_metric_keys_for_site(db, site_id=site_id, keys=keys)[:24]

    for k in keys:
        k_latest[str(k)] = _resolve_kpi_metric_value(merged, str(k))

    if st_lower in ("data_object", "result_object"):
        ts_kind = st_lower
    elif st_lower in ("latest_device_state", "device_state"):
        ts_kind = "latest_device_state"
    else:
        ts_kind = ""

    if include_timescale_history and ts_kind and keys:
        ts_1h, ts_24h = query_map_kpi_recent_pair(
            customer_id=customer_id,
            object_kind=ts_kind,
            object_id=source_id,
            kpi_keys=keys,
        )
    else:
        ts_1h, ts_24h = [], []

    health = {
        "health_status": merged.get("health_status"),
        "health_message": merged.get("health_message"),
    }

    trend_context: dict[str, Any] | None = None
    if st_lower in ("latest_device_state", "device_state"):
        lds = db.get(LatestDeviceState, source_id)
        if lds:
            ts = (trend_scope or "resolved_device").strip().lower()
            if ts not in ("resolved_device", "endpoint", "site"):
                ts = "resolved_device"
            if ts == "endpoint":
                trend_context = {
                    "scope": "endpoint",
                    "entityId": str(lds.endpoint_id),
                    "endpointId": str(lds.endpoint_id),
                    "metricKeys": list(k_latest.keys())[:24],
                }
            elif ts == "site":
                trend_context = {
                    "scope": "site",
                    "entityId": str(site_id),
                    "endpointId": str(lds.endpoint_id),
                    "metricKeys": list(k_latest.keys())[:24],
                }
            else:
                trend_context = {
                    "scope": "resolved_device",
                    "entityId": str(lds.resolved_device_id),
                    "endpointId": str(lds.endpoint_id),
                    "metricKeys": list(k_latest.keys())[:24],
                }
    elif st_lower in ("data_object", "result_object"):
        trend_context = {
            "mode": "map_object_timescale",
            "sourceType": st_lower,
            "sourceId": str(source_id),
            "metricKeys": list(k_latest.keys())[:24],
        }

    device_display_name: str | None = None
    if st_lower in ("latest_device_state", "device_state"):
        lab = merged.get("device_label")
        if isinstance(lab, str) and lab.strip():
            device_display_name = lab.strip()
        else:
            rd = db.get(ResolvedDevice, row.resolved_device_id)
            if rd and isinstance(rd.device_label, str) and rd.device_label.strip():
                device_display_name = rd.device_label.strip()
            elif getattr(row, "object_name", None):
                device_display_name = str(row.object_name).strip()

    out: dict[str, Any] = {
        "source_type": st_lower,
        "source_id": str(source_id),
        "site_id": str(site_id),
        "device_display_name": device_display_name,
        "display_fields": display_fields,
        "health": health,
        "kpi_latest": k_latest,
        "kpi_windows_redis": {"1h": series_1h, "24h": series_24h},
        "kpi_history_timescale": {"1h": ts_1h, "24h": ts_24h},
        "trend": (state or {}).get("trend"),
        "redis_state": state,
        "trend_context": trend_context,
    }
    if read_ctx_lds is not None:
        out["governance"] = governance_dict(read_ctx_lds)
    return out


def internal_aggregator_visibility() -> dict[str, Any]:
    return {"stats": aggregator_stats(), "redis_key": "aar:map:aggregator:stats"}
