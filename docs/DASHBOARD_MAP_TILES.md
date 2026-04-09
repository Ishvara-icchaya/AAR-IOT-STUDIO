# Dashboard map tiles (production policy)

## Configuration precedence

1. **`layout.settings.map_style_url`** or **`mapStyleUrl`** (stored on the dashboard JSON) — highest priority for per-dashboard overrides.
2. **Server environment** — `AAR_DASHBOARD_MAP_STYLE_URL` (full MapLibre style JSON URL). Use this for fleet-wide or on-prem tile endpoints.
3. **Default** — MapLibre public demo style (`https://demotiles.maplibre.org/style.json`) when nothing else is set.

The live and preview APIs expose the resolved URL under `dashboard.settings.map_style_url` and set `uses_default_demo_tiles` when the demo default is in effect (no env override and no layout override).

## Frontend override

`VITE_DASHBOARD_MAP_STYLE_URL` is read in the browser **only if** the API did not return a `map_style_url` (fallback for local dev).

## Offline / blocked egress

If the style URL fails to load (network, firewall, or 403), the map widget falls back to a **minimal blank background style** (no external tiles) and keeps markers usable. Operators should set `AAR_DASHBOARD_MAP_STYLE_URL` to an internal style endpoint for air-gapped deployments.

## Licensing

Raster/vector tile providers impose their own terms. The default demo tiles are **not** a production basemap commitment — configure an explicit provider or self-hosted tiles before rollout.
