"""Dashboard runtime defaults (map tiles, refresh) for live payloads and ops."""

from __future__ import annotations

import os
from typing import Any

# Public demo style — replace via AAR_DASHBOARD_MAP_STYLE_URL or layout.settings for production.
# Carto Voyager (MapLibre GL) — modern vector tiles; keep in sync with frontend DEFAULT_MAP_STYLE_URL.
DEFAULT_MAP_STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"


def map_style_url_from_env() -> str:
    v = (os.environ.get("AAR_DASHBOARD_MAP_STYLE_URL") or "").strip()
    return v if v else DEFAULT_MAP_STYLE_URL


def merge_layout_settings(layout: dict[str, Any] | None) -> dict[str, Any]:
    """
    Produces `dashboard.settings` in live/preview API responses.
    Precedence: layout.settings.map_style_url (camel or snake) > AAR_DASHBOARD_MAP_STYLE_URL > default demo tiles.
    refresh_interval_sec: layout > default 30, clamped [5, 3600].
    """
    raw = dict(layout or {})
    s = dict(raw.get("settings") or {})
    url = (
        s.get("mapStyleUrl")
        or s.get("map_style_url")
        or map_style_url_from_env()
    )
    if not isinstance(url, str) or not url.strip():
        url = DEFAULT_MAP_STYLE_URL
    else:
        url = str(url).strip()
    ref = s.get("refreshIntervalSec") if s.get("refreshIntervalSec") is not None else s.get("refresh_interval_sec")
    try:
        refresh = int(ref) if ref is not None else 30
    except (TypeError, ValueError):
        refresh = 30
    refresh = max(5, min(3600, refresh))
    return {
        "map_style_url": url,
        "refresh_interval_sec": refresh,
        "uses_default_demo_tiles": url == DEFAULT_MAP_STYLE_URL and not (os.environ.get("AAR_DASHBOARD_MAP_STYLE_URL") or "").strip(),
    }
