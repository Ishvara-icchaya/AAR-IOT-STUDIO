"""Rules for map-eligible data_object / result_object (dashboard map runtime)."""

from __future__ import annotations

from typing import Any


def _get_path(obj: Any, path: str) -> Any:
    cur: Any = obj
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _coerce_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _extract_lat_lon(payload: dict[str, Any], latf: str, lonf: str) -> tuple[float | None, float | None]:
    lat = _coerce_float(_get_path(payload, latf))
    lon = _coerce_float(_get_path(payload, lonf))
    if lat is None:
        lat = _coerce_float(payload.get(latf))
    if lon is None:
        lon = _coerce_float(payload.get(lonf))
    if lat is None:
        lat = _coerce_float(_get_path(payload, "gps.lat"))
    if lon is None:
        lon = _coerce_float(_get_path(payload, "gps.lon"))
    return lat, lon


def _lifecycle_ok_data_object(status: str | None) -> bool:
    return (status or "").lower() in ("published", "compiled")


def _has_display_or_kpi_signals(payload: dict[str, Any], kpi_json: dict[str, Any] | None) -> bool:
    df = payload.get("displayFields")
    if isinstance(df, dict) and len(df) > 0:
        return True
    kpi = kpi_json or {}
    if isinstance(kpi.get("displayFields"), (dict, list)):
        if isinstance(kpi["displayFields"], dict) and kpi["displayFields"]:
            return True
        if isinstance(kpi["displayFields"], list) and kpi["displayFields"]:
            return True
    met = kpi.get("metrics")
    if isinstance(met, dict) and len(met) > 0:
        return True
    return False


def _has_health_signal(payload: dict[str, Any], row_health: str | None, has_health_flag: bool) -> bool:
    if has_health_flag:
        return True
    hs = payload.get("health_status")
    if isinstance(hs, str) and hs.strip():
        return True
    if row_health and str(row_health).strip():
        return True
    return False


def _has_kpi_signal(payload: dict[str, Any], kpi_json: dict[str, Any] | None, has_kpi_flag: bool) -> bool:
    if has_kpi_flag:
        return True
    kpi = kpi_json or {}
    if isinstance(kpi.get("metrics"), dict) and kpi["metrics"]:
        return True
    if isinstance(kpi.get("displayFields"), dict) and kpi["displayFields"]:
        return True
    return _has_display_or_kpi_signals(payload, kpi_json)


def map_eligible_data_object(
    *,
    lifecycle_status: str | None,
    payload: dict[str, Any],
    kpi_json: dict[str, Any],
    has_gps: bool,
    has_kpi: bool,
    has_health: bool,
    lat_field: str = "gps.lat",
    lon_field: str = "gps.lon",
) -> bool:
    if not _lifecycle_ok_data_object(lifecycle_status):
        return False
    if not has_gps:
        return False
    lat, lon = _extract_lat_lon(payload, lat_field, lon_field)
    if lat is None or lon is None:
        return False
    content = (
        _has_display_or_kpi_signals(payload, kpi_json)
        or _has_health_signal(payload, None, has_health)
        or _has_kpi_signal(payload, kpi_json, has_kpi)
    )
    return bool(content)


def map_eligible_result_object(
    *,
    payload: dict[str, Any],
    lat_field: str = "gps.lat",
    lon_field: str = "gps.lon",
) -> bool:
    """Frozen workflow outputs: treat as published; require GPS + at least one signal."""
    lat, lon = _extract_lat_lon(payload, lat_field, lon_field)
    if lat is None or lon is None:
        return False
    empty_kpi: dict[str, Any] = {}
    content = (
        _has_display_or_kpi_signals(payload, empty_kpi)
        or _has_health_signal(payload, payload.get("health_status") if isinstance(payload.get("health_status"), str) else None, False)
        or _has_kpi_signal(payload, empty_kpi, False)
    )
    return bool(content)


def extract_gps_coords(
    payload: dict[str, Any], lat_field: str, lon_field: str
) -> tuple[float | None, float | None]:
    return _extract_lat_lon(payload, lat_field, lon_field)


def lat_lon_from_lds_row_fragments(
    *,
    location_json: dict[str, Any] | None,
    display_json: dict[str, Any] | None,
    kpi_json: dict[str, Any] | None,
) -> tuple[float | None, float | None]:
    """Coordinates for v2 LDS map rows: ``location_json`` first, then flat keys on merged display/kpi.

    Many MQTT payloads use ``geo_lat`` / ``geo_long`` at the top level instead of ``gps.lat`` / ``gps.lon``.
    """
    loc = location_json if isinstance(location_json, dict) else {}
    lat = _coerce_float(loc.get("lat"))
    lon = _coerce_float(loc.get("lon"))
    if lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
        return lat, lon
    merged: dict[str, Any] = {}
    if isinstance(display_json, dict):
        merged.update(display_json)
    if isinstance(kpi_json, dict):
        merged.update(kpi_json)
    for lat_key, lon_key in (
        ("geo_lat", "geo_long"),
        ("geo_lat", "geo_lon"),
        ("latitude", "longitude"),
        ("lat", "lon"),
    ):
        la = _coerce_float(merged.get(lat_key))
        lo = _coerce_float(merged.get(lon_key))
        if la is not None and lo is not None and -90 <= la <= 90 and -180 <= lo <= 180:
            return la, lo
    return None, None
