import type { MapMarkersQueryBody } from "@/api/dashboard";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";

/** Map controls — from server map_controls or defaults (not marker geometry). */
export type MapControlsVM = {
  auto_fit_on_first_load: boolean;
  auto_fit_on_refresh: boolean;
  preserve_viewport: boolean;
  cluster_markers: boolean;
  max_direct_markers: number;
};

export type MapInitVM = {
  center?: [number, number];
  zoom?: number;
  bounds?: [[number, number], [number, number]];
};

/**
 * Non-marker map widget inputs: binding metadata + chrome only.
 * Marker positions must come from POST /map-runtime/markers/query, not block.data.markers.
 */
export type MapChromeVM = {
  siteId: string | null;
  latitudeField: string;
  longitudeField: string;
  kpiFields: string[];
  excludedSourceIds: string[];
  deviceIds: string[] | undefined;
  titleField: string | null;
  healthField: string | null;
  mapControls: MapControlsVM;
  /** Hint from live payload when API has not returned yet (optional). */
  mapInitHint: MapInitVM | undefined;
  apiMode: "auto" | "manual" | "single";
  includedSources: unknown[] | null;
  singleSourceType: string | null;
  singleSourceId: string | null;
  manualSources: boolean;
  degraded: boolean;
  warning: string | null;
  sourceMissing: boolean;
  mapProfile: "site" | "fleet";
};

function readControls(d: Record<string, unknown>): MapControlsVM {
  const c = (d.map_controls as Record<string, unknown>) || {};
  const mx = c.max_direct_markers ?? c.maxDirectMarkers;
  return {
    auto_fit_on_first_load: c.auto_fit_on_first_load !== false && c.autoFitOnFirstLoad !== false,
    auto_fit_on_refresh: c.auto_fit_on_refresh === true || c.autoFitOnRefresh === true,
    preserve_viewport: c.preserve_viewport !== false && c.preserveViewport !== false,
    cluster_markers: c.cluster_markers !== false && c.clusterMarkers !== false,
    max_direct_markers: typeof mx === "number" && Number.isFinite(mx) ? mx : 80,
  };
}

export function parseMapInit(m: unknown): MapInitVM | undefined {
  if (!m || typeof m !== "object") return undefined;
  const o = m as Record<string, unknown>;
  const center = o.center;
  const bounds = o.bounds;
  const zoom = o.zoom;
  let c: [number, number] | undefined;
  if (Array.isArray(center) && center.length >= 2 && typeof center[0] === "number" && typeof center[1] === "number") {
    c = [center[0], center[1]];
  }
  let b: [[number, number], [number, number]] | undefined;
  if (
    Array.isArray(bounds) &&
    bounds.length === 2 &&
    Array.isArray(bounds[0]) &&
    Array.isArray(bounds[1])
  ) {
    const a0 = bounds[0] as unknown[];
    const a1 = bounds[1] as unknown[];
    if (
      a0.length >= 2 &&
      a1.length >= 2 &&
      typeof a0[0] === "number" &&
      typeof a0[1] === "number" &&
      typeof a1[0] === "number" &&
      typeof a1[1] === "number"
    ) {
      b = [
        [a0[0], a0[1]],
        [a1[0], a1[1]],
      ];
    }
  }
  const z = typeof zoom === "number" && Number.isFinite(zoom) ? zoom : undefined;
  if (!c && !b) return undefined;
  return { center: c, zoom: z, bounds: b };
}

/**
 * Adapter: widget payload → map chrome VM (no markers).
 */
export function adaptMapChrome(block: DashboardLiveWidgetDTO): MapChromeVM {
  const d = block.data && typeof block.data === "object" ? (block.data as Record<string, unknown>) : {};
  const siteRaw = d.site_id;
  const siteId = typeof siteRaw === "string" && siteRaw.trim() ? siteRaw.trim() : null;

  const latf = String(d.latitude_field ?? "gps.lat");
  const lonf = String(d.longitude_field ?? "gps.lon");

  const kpiRaw = d.kpi_fields;
  const kpiFields = Array.isArray(kpiRaw) ? kpiRaw.map(String) : [];

  const exRaw = d.excluded_source_ids;
  const excludedSourceIds = Array.isArray(exRaw) ? exRaw.map(String) : [];

  const devRaw = d.device_ids;
  const deviceIds = Array.isArray(devRaw) ? devRaw.map(String) : undefined;

  const tf = d.title_field;
  const hf = d.health_field;
  const titleField = typeof tf === "string" ? tf : null;
  const healthField = typeof hf === "string" ? hf : null;

  const manualSources = d.manual_sources === true;
  const incRaw = d.included_sources;
  const includedSources = Array.isArray(incRaw) ? incRaw : null;

  const mode = String(d.mode ?? "");
  const st = typeof d.source_type === "string" ? d.source_type : null;
  const sid = typeof d.source_id === "string" ? d.source_id : null;

  let apiMode: "auto" | "manual" | "single" = "auto";
  if (manualSources && includedSources && includedSources.length > 0) {
    apiMode = "manual";
  } else if (mode === "single" && st && sid) {
    apiMode = "single";
  }

  const mp = d.map_profile;
  const mapProfile: "site" | "fleet" =
    block.type === "fleet_map" || mp === "fleet" ? "fleet" : "site";

  return {
    siteId,
    latitudeField: latf,
    longitudeField: lonf,
    kpiFields,
    excludedSourceIds,
    deviceIds,
    titleField,
    healthField,
    mapControls: readControls(d),
    mapInitHint: parseMapInit(d.map_init),
    apiMode,
    includedSources,
    singleSourceType: st,
    singleSourceId: sid,
    manualSources,
    degraded: d.degraded === true,
    warning: typeof d.warning === "string" ? d.warning : null,
    sourceMissing: d.source_missing === true,
    mapProfile,
  };
}

/** Stable key for refetching markers when live payload metadata changes (excludes markers). */
export function mapChromeFetchKey(chrome: MapChromeVM): string {
  return JSON.stringify({
    siteId: chrome.siteId,
    lat: chrome.latitudeField,
    lon: chrome.longitudeField,
    kpi: chrome.kpiFields,
    ex: chrome.excludedSourceIds,
    dev: chrome.deviceIds,
    titleField: chrome.titleField,
    healthField: chrome.healthField,
    mode: chrome.apiMode,
    inc: chrome.includedSources,
    single: [chrome.singleSourceType, chrome.singleSourceId],
    manual: chrome.manualSources,
  });
}

/** Build POST /markers/query body from chrome VM. Returns null if required fields are missing. */
export function buildMarkersQueryBody(chrome: MapChromeVM): MapMarkersQueryBody | null {
  if (!chrome.siteId) return null;
  const base: MapMarkersQueryBody = {
    site_id: chrome.siteId,
    latitude_field: chrome.latitudeField,
    longitude_field: chrome.longitudeField,
    kpi_fields: chrome.kpiFields,
    excluded_source_ids: chrome.excludedSourceIds,
    title_field: chrome.titleField,
    health_field: chrome.healthField,
    light: true,
    mode: "auto",
  };
  if (chrome.deviceIds?.length) {
    base.device_ids = chrome.deviceIds;
  }
  if (chrome.apiMode === "single") {
    if (!chrome.singleSourceType?.trim() || !chrome.singleSourceId?.trim()) return null;
    return {
      ...base,
      mode: "single",
      single_source_type: chrome.singleSourceType,
      single_source_id: chrome.singleSourceId,
    };
  }
  if (chrome.apiMode === "manual") {
    return {
      ...base,
      mode: "manual",
      included_sources: chrome.includedSources ?? [],
    };
  }
  return { ...base, mode: "auto" };
}
