/**
 * Default vector basemap (Carto Voyager — MapLibre-compatible, clear typography & roads).
 * Must stay aligned with server `app/core/dashboard_runtime.DEFAULT_MAP_STYLE_URL`.
 */
export const DEFAULT_MAP_STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

/** Minimal MapLibre style when external style URL fails (no tile egress). */
export const OFFLINE_FALLBACK_MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "dashboard-bg",
      type: "background",
      paint: { "background-color": "#1a2332" },
    },
  ],
} as const;
