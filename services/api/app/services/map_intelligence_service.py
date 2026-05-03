"""Expanded map intelligence: mobility, server-side freshness, aggregates, scrubbed-event paths."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.models.endpoint import Endpoint
from app.models.latest_device_state import LatestDeviceState
from app.models.resolved_device import ResolvedDevice
from app.models.scrubbed_event import ScrubbedEvent
from app.services.trend_metrics_policy import filter_metric_keys_for_site


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_float(v: Any) -> float | None:
    try:
        if v is None:
            return None
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def extract_heading_deg(location_json: dict[str, Any] | None) -> float | None:
    if not isinstance(location_json, dict):
        return None
    for k in ("heading_deg", "heading", "course", "bearing"):
        h = parse_float(location_json.get(k))
        if h is not None:
            return h
    return None


def read_endpoint_intelligence_defaults(endpoint: Endpoint) -> tuple[int, str | None]:
    """Returns (expected_frequency_sec, mobility_type override or None)."""
    ac = endpoint.auth_config if isinstance(endpoint.auth_config, dict) else {}
    freq = ac.get("expected_ingest_interval_sec")
    if freq is None:
        freq = ac.get("expectedFrequencySec")
    try:
        sec = int(freq) if freq is not None else 15
    except (TypeError, ValueError):
        sec = 15
    sec = max(5, min(sec, 3600))
    mt = ac.get("mobility_type") or ac.get("mobilityType")
    mts = str(mt).strip().lower() if mt is not None else None
    if mts in ("static", "dynamic"):
        return sec, mts
    return sec, None


def read_display_mobility(display_json: dict[str, Any]) -> dict[str, Any]:
    mi = display_json.get("map_intelligence") or display_json.get("mapIntelligence")
    return mi if isinstance(mi, dict) else {}


def infer_mobility(
    endpoint_default: str | None,
    display_mi: dict[str, Any],
    heading: float | None,
    object_name: str,
) -> tuple[str, bool]:
    """Return (mobility_type, has_heading flag for UI)."""
    raw = display_mi.get("mobilityType") or display_mi.get("mobility_type")
    if isinstance(raw, str) and raw.strip().lower() in ("static", "dynamic", "unknown"):
        mt = raw.strip().lower()
        has_h = heading is not None or display_mi.get("hasHeading") is True or display_mi.get("has_heading") is True
        return mt, bool(has_h)
    if endpoint_default in ("static", "dynamic"):
        has_h = heading is not None
        return endpoint_default, has_h
    on = (object_name or "").lower()
    if any(x in on for x in ("pole", "sensor", "camera", "fixed", "site asset")):
        return "static", heading is not None
    if heading is not None:
        return "dynamic", True
    return "unknown", False


def last_observed_at(row: LatestDeviceState) -> datetime | None:
    if row.last_ingested_at:
        return row.last_ingested_at
    if row.last_event_ts:
        return row.last_event_ts
    return row.updated_at


def compute_freshness_status(last_obs: datetime | None, expected_sec: int, now: datetime) -> str:
    """active | stale | offline | unknown — server-side from last observation age."""
    if last_obs is None:
        return "unknown"
    age = (now - last_obs).total_seconds()
    if age < 0:
        return "active"
    stale_after = max(15.0, float(expected_sec) * 3.0)
    offline_after = max(60.0, float(expected_sec) * 10.0)
    if age < stale_after:
        return "active"
    if age < offline_after:
        return "stale"
    return "offline"


def _lat_lon_from_location(loc: dict[str, Any]) -> tuple[float | None, float | None]:
    lat = parse_float(loc.get("lat") or loc.get("latitude"))
    lon = parse_float(loc.get("lon") or loc.get("longitude") or loc.get("lng"))
    return lat, lon


def fetch_lds_rows(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    endpoint_id: uuid.UUID | None,
) -> list[LatestDeviceState]:
    q = select(LatestDeviceState).where(
        LatestDeviceState.customer_id == customer_id,
        LatestDeviceState.site_id == site_id,
    )
    if endpoint_id is not None:
        q = q.where(LatestDeviceState.endpoint_id == endpoint_id)
    return list(db.scalars(q).all())


def build_device_intel_dict(
    row: LatestDeviceState,
    endpoint: Endpoint,
    rd: ResolvedDevice | None,
    now: datetime,
    kpi_keys: list[str],
) -> dict[str, Any]:
    exp_sec, ep_mob = read_endpoint_intelligence_defaults(endpoint)
    disp = row.display_json if isinstance(row.display_json, dict) else {}
    mi = read_display_mobility(disp)
    freq_override = mi.get("expectedFrequencySec") or mi.get("expected_frequency_sec")
    try:
        if freq_override is not None:
            exp_sec = max(5, min(int(freq_override), 3600))
    except (TypeError, ValueError):
        pass
    loc = row.location_json if isinstance(row.location_json, dict) else {}
    heading = extract_heading_deg(loc)
    mob, has_h = infer_mobility(ep_mob, mi, heading, str(row.object_name or ""))
    last_obs = last_observed_at(row)
    freshness = compute_freshness_status(last_obs, exp_sec, now)
    first_at = rd.created_at.isoformat() if rd and getattr(rd, "created_at", None) else None
    kpv: dict[str, Any] = {}
    kj = row.kpi_json if isinstance(row.kpi_json, dict) else {}
    for k in kpi_keys[:24]:
        if k in kj:
            kpv[k] = kj.get(k)
    return {
        "scope": "resolved_device",
        "entityId": str(row.resolved_device_id),
        "source_type": "latest_device_state",
        "source_id": str(row.id),
        "endpoint_id": str(row.endpoint_id),
        "display_name": (disp.get("device_label") if isinstance(disp.get("device_label"), str) else None)
        or row.object_name,
        "mobility_type": mob,
        "has_heading": has_h,
        "expected_frequency_sec": exp_sec,
        "heading_deg": heading,
        "first_observed_at": first_at,
        "last_observed_at": last_obs.isoformat() if last_obs else None,
        "freshness_status": freshness,
        "health_status": row.health_status,
        "latest_kpis": kpv,
    }


def build_expanded_intelligence(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    endpoint_id: uuid.UUID | None,
    mode: str,
    page: int,
    limit: int,
    kpi_keys: list[str],
) -> dict[str, Any]:
    now = utc_now()
    keys = filter_metric_keys_for_site(db, site_id=site_id, keys=kpi_keys)
    rows = fetch_lds_rows(db, customer_id=customer_id, site_id=site_id, endpoint_id=endpoint_id)
    ep_cache: dict[uuid.UUID, Endpoint | None] = {}

    def get_ep(eid: uuid.UUID) -> Endpoint | None:
        if eid not in ep_cache:
            ep_cache[eid] = db.get(Endpoint, eid)
        return ep_cache[eid]

    devices_full: list[dict[str, Any]] = []
    counts = {"active": 0, "stale": 0, "offline": 0, "unknown": 0}
    refresh_min = 300
    for row in rows:
        ep = get_ep(row.endpoint_id)
        if not ep or ep.customer_id != customer_id or ep.site_id != site_id:
            continue
        exp_sec, _ = read_endpoint_intelligence_defaults(ep)
        refresh_min = min(refresh_min, exp_sec)
        rd = db.get(ResolvedDevice, row.resolved_device_id)
        d = build_device_intel_dict(row, ep, rd, now, keys)
        devices_full.append(d)
        fs = d["freshness_status"]
        if fs in counts:
            counts[fs] += 1

    devices_full.sort(key=lambda x: str(x.get("display_name") or "").lower())
    total = len(devices_full)
    page = max(1, page)
    limit = max(1, min(limit, 200))
    start = (page - 1) * limit
    devices_page = devices_full[start : start + limit]

    aggregate_kpis: dict[str, float] = {}
    for key in keys[:12]:
        vals: list[float] = []
        for row in rows:
            ep = get_ep(row.endpoint_id)
            if not ep or ep.customer_id != customer_id:
                continue
            kj = row.kpi_json if isinstance(row.kpi_json, dict) else {}
            fv = parse_float(kj.get(key))
            if fv is not None:
                vals.append(fv)
        if vals:
            aggregate_kpis[key] = sum(vals) / len(vals)

    observable_window_sec = max(15, refresh_min * 3)

    if endpoint_id:
        ep = db.get(Endpoint, endpoint_id)
        if not ep or ep.site_id != site_id or ep.customer_id != customer_id:
            ep_block: dict[str, Any] | None = None
        else:
            exp_ep, mob_ep = read_endpoint_intelligence_defaults(ep)
            ep_block = {
                "id": str(ep.id),
                "name": ep.endpoint_name,
                "object_name": ep.object_name,
                "mobility_type_default": mob_ep or "unknown",
                "expected_frequency_sec": exp_ep,
                "device_count": len(devices_full),
                "active_count": counts["active"],
                "stale_count": counts["stale"],
                "offline_count": counts["offline"],
                "unknown_count": counts["unknown"],
            }
    else:
        ep_block = {
            "id": None,
            "name": "Site (all endpoints)",
            "device_count": len(devices_full),
            "active_count": counts["active"],
            "stale_count": counts["stale"],
            "offline_count": counts["offline"],
            "unknown_count": counts["unknown"],
        }

    trend_keys = keys[:12]
    trend_ctx: dict[str, Any] = {
        "site": {"entityId": str(site_id), "scope": "site", "metricKeys": trend_keys},
    }
    if endpoint_id:
        trend_ctx["endpoint"] = {"entityId": str(endpoint_id), "scope": "endpoint", "metricKeys": trend_keys}

    return {
        "mode": mode,
        "refresh_interval_sec": max(5, min(refresh_min, 300)),
        "observable_window_sec": observable_window_sec,
        "endpoint": ep_block,
        "aggregate_kpis": aggregate_kpis,
        "devices": devices_page,
        "devices_total": total,
        "page": page,
        "limit": limit,
        "trend_context": trend_ctx,
        "supports_historical_path": True,
    }


def build_device_path(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    resolved_device_id: uuid.UUID,
    from_ts: datetime | None,
    to_ts: datetime | None,
    expected_frequency_sec: int = 15,
    max_points: int = 4000,
) -> dict[str, Any]:
    """Footprint from scrubbed_events.location_json (ingestion trail)."""
    conds = [
        ScrubbedEvent.customer_id == customer_id,
        ScrubbedEvent.site_id == site_id,
        ScrubbedEvent.resolved_device_id == resolved_device_id,
    ]
    if from_ts is not None:
        conds.append(ScrubbedEvent.event_ts >= from_ts)
    if to_ts is not None:
        conds.append(ScrubbedEvent.event_ts <= to_ts)
    stmt = (
        select(ScrubbedEvent).where(*conds).order_by(ScrubbedEvent.event_ts.asc()).limit(max_points)
    )
    rows = list(db.scalars(stmt).all())

    points: list[dict[str, Any]] = []
    for r in rows:
        loc = r.location_json if isinstance(r.location_json, dict) else {}
        lat, lon = _lat_lon_from_location(loc)
        if lat is None or lon is None:
            continue
        h = extract_heading_deg(loc)
        points.append(
            {
                "ts": r.event_ts.isoformat(),
                "lat": lat,
                "lng": lon,
                "heading_deg": h,
            }
        )

    gaps: list[dict[str, Any]] = []
    stale_segments: list[dict[str, int]] = []
    gap_threshold = max(30.0, float(expected_frequency_sec) * 3.0)
    for i in range(1, len(points)):
        t0 = datetime.fromisoformat(points[i - 1]["ts"].replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(points[i]["ts"].replace("Z", "+00:00"))
        dt = (t1 - t0).total_seconds()
        if dt > gap_threshold:
            gaps.append(
                {
                    "after_index": i - 1,
                    "gap_sec": dt,
                    "lat": points[i]["lat"],
                    "lng": points[i]["lng"],
                }
            )
            stale_segments.append({"start_index": i - 1, "end_index": i})

    first_observed_at = points[0]["ts"] if points else None
    last_observed_at = points[-1]["ts"] if points else None
    polyline: list[list[float]] = [[p["lng"], p["lat"]] for p in points]

    return {
        "scope": "resolved_device",
        "entityId": str(resolved_device_id),
        "points": points,
        "polyline": polyline,
        "gaps": gaps,
        "stale_segments": stale_segments,
        "first_observed_at": first_observed_at,
        "last_observed_at": last_observed_at,
        "expected_frequency_sec": expected_frequency_sec,
    }


def build_site_historical_sample_points(
    db: Session,
    *,
    customer_id: uuid.UUID,
    site_id: uuid.UUID,
    endpoint_id: uuid.UUID | None,
    from_ts: datetime | None,
    to_ts: datetime | None,
    max_points: int = 400,
) -> dict[str, Any]:
    """Deduped scrubbed-event coordinates for a time window (site or single endpoint)."""
    to = to_ts or utc_now()
    from_ = from_ts or (to - timedelta(hours=24))
    conds = [
        ScrubbedEvent.customer_id == customer_id,
        ScrubbedEvent.site_id == site_id,
        ScrubbedEvent.event_ts >= from_,
        ScrubbedEvent.event_ts <= to,
    ]
    if endpoint_id is not None:
        rd_ids = select(ResolvedDevice.id).where(
            ResolvedDevice.endpoint_id == endpoint_id,
            ResolvedDevice.site_id == site_id,
            ResolvedDevice.customer_id == customer_id,
        )
        conds.append(ScrubbedEvent.resolved_device_id.in_(rd_ids))
    cap = max(200, min(int(max_points) * 6, 4000))
    stmt = select(ScrubbedEvent).where(*conds).order_by(ScrubbedEvent.event_ts.desc()).limit(cap)
    rows = list(db.scalars(stmt).all())
    seen: set[tuple[float, float]] = set()
    kept: list[tuple[ScrubbedEvent, float, float, float | None]] = []
    for r in rows:
        loc = r.location_json if isinstance(r.location_json, dict) else {}
        lat, lon = _lat_lon_from_location(loc)
        if lat is None or lon is None:
            continue
        key = (round(float(lat), 4), round(float(lon), 4))
        if key in seen:
            continue
        seen.add(key)
        h = extract_heading_deg(loc)
        kept.append((r, float(lat), float(lon), h))
        if len(kept) >= max(50, min(int(max_points), 2000)):
            break

    pair_set: set[tuple[uuid.UUID, str]] = {(r.resolved_device_id, r.object_name) for r, _, _, _ in kept}
    lds_map: dict[tuple[uuid.UUID, str], uuid.UUID] = {}
    if pair_set:
        pairs = list(pair_set)
        base_lds = select(
            LatestDeviceState.id,
            LatestDeviceState.resolved_device_id,
            LatestDeviceState.object_name,
        ).where(
            LatestDeviceState.customer_id == customer_id,
            LatestDeviceState.site_id == site_id,
        )
        chunk_size = 400
        for i in range(0, len(pairs), chunk_size):
            chunk = pairs[i : i + chunk_size]
            q = base_lds.where(tuple_(LatestDeviceState.resolved_device_id, LatestDeviceState.object_name).in_(chunk))
            res = db.execute(q)
            for lid, rdid, oname in res:
                lds_map[(rdid, oname)] = lid

    rich_sample_points: list[dict[str, Any]] = []
    poly: list[list[float]] = []
    for r, lat, lon, h in kept:
        pair_key = (r.resolved_device_id, r.object_name)
        lid = lds_map.get(pair_key)
        ident = r.identity_json if isinstance(r.identity_json, dict) else {}
        lab: str | None = None
        dl = ident.get("device_label")
        if isinstance(dl, str) and dl.strip():
            lab = dl.strip()
        elif isinstance(r.object_name, str) and r.object_name.strip():
            lab = r.object_name.strip()
        rp: dict[str, Any] = {
            "scrubbed_event_id": str(r.id),
            "resolved_device_id": str(r.resolved_device_id),
            "endpoint_id": str(r.endpoint_id),
            "event_ts": r.event_ts.isoformat().replace("+00:00", "Z"),
            "ingested_at": r.ingested_at.isoformat().replace("+00:00", "Z"),
            "lat": lat,
            "lng": lon,
            "heading_deg": h,
            "label": lab,
            "object_name": r.object_name,
            "source": "historical",
        }
        if lid is not None:
            rp["latest_device_state_id"] = str(lid)
        rich_sample_points.append(rp)
        poly.append([float(lon), float(lat)])

    return {
        "sample_points": poly,
        "rich_sample_points": rich_sample_points,
        "count": len(poly),
        "from": from_.isoformat().replace("+00:00", "Z"),
        "to": to.isoformat().replace("+00:00", "Z"),
    }
