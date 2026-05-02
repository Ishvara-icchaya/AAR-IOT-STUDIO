import { apiFetch } from "@/api/client";
import type {
  DashboardLayoutV1,
  DashboardListItemDTO,
  DashboardLiveDTO,
  DashboardReadDTO,
  EnterpriseSiteObjectCountsDTO,
} from "@/types/dashboard";
import type {
  DashboardRuntimeLayoutDTO,
  DashboardWidgetsResolveBatchRequestDTO,
  DashboardWidgetsResolveBatchResponseDTO,
} from "@/types/dashboardWidgetRuntime";

export async function listDashboards(params?: { site_id?: string; q?: string }) {
  const qs = new URLSearchParams();
  if (params?.site_id) qs.set("site_id", params.site_id);
  if (params?.q) qs.set("q", params.q);
  const s = qs.toString();
  return apiFetch<{ items: DashboardListItemDTO[] }>(`/dashboards${s ? `?${s}` : ""}`);
}

export async function getDashboard(id: string) {
  return apiFetch<DashboardReadDTO>(`/dashboards/${id}`);
}

export type DashboardCreateBody = {
  site_id: string;
  name: string;
  description?: string | null;
  layout?: DashboardLayoutV1 | Record<string, unknown>;
};

export async function createDashboard(body: DashboardCreateBody) {
  return apiFetch<DashboardReadDTO>("/dashboards", { method: "POST", json: body });
}

export type DashboardUpdateBody = {
  name?: string;
  description?: string | null;
  site_id?: string | null;
  layout?: Record<string, unknown> | null;
};

export async function updateDashboard(id: string, body: DashboardUpdateBody) {
  return apiFetch<DashboardReadDTO>(`/dashboards/${id}`, { method: "PUT", json: body });
}

export async function deleteDashboard(id: string) {
  return apiFetch<null>(`/dashboards/${id}`, { method: "DELETE" });
}

export async function duplicateDashboard(id: string) {
  return apiFetch<DashboardReadDTO>(`/dashboards/${id}/duplicate`, { method: "POST" });
}

export async function freezeDashboard(id: string) {
  return apiFetch<{ id: string; status: string }>(`/dashboards/${id}/freeze`, { method: "POST" });
}

export async function unfreezeDashboard(id: string) {
  return apiFetch<DashboardReadDTO>(`/dashboards/${id}/unfreeze`, { method: "POST" });
}

export async function setPrimaryDashboard(id: string) {
  return apiFetch<DashboardReadDTO>(`/dashboards/${id}/set-primary`, { method: "POST" });
}

export async function clearPrimaryDashboard() {
  return apiFetch<{ primary_dashboard_id: string | null }>("/dashboards/clear-primary", {
    method: "POST",
  });
}

/** Layout + widget definitions only (no widget data). Use `postDashboardWidgetsResolveBatch` for data. */
export async function getDashboardRuntimeLayout(id: string) {
  return apiFetch<DashboardRuntimeLayoutDTO>(`/dashboards/${id}/runtime-layout`);
}

/** Canonical widget data path: backend-prepared payloads per DASHBOARD_WIDGET_CONTRACT. */
export async function postDashboardWidgetsResolveBatch(body: DashboardWidgetsResolveBatchRequestDTO) {
  return apiFetch<DashboardWidgetsResolveBatchResponseDTO>(
    `/dashboards/runtime/widgets/resolve-batch`,
    { method: "POST", json: body },
  );
}

export async function getDashboardLive(id: string) {
  return apiFetch<DashboardLiveDTO>(`/dashboards/${id}/live`);
}

export async function previewDashboard(id: string, body?: { layout?: Record<string, unknown> }) {
  return apiFetch<DashboardLiveDTO>(`/dashboards/${id}/preview`, {
    method: "POST",
    json: body ?? {},
  });
}

export type ResolvedDashboardQuery = {
  siteId?: string | null;
  /** Filter recent alerts/activity to the past N hours (synthetic path). */
  hours?: number;
};

/** Resolved view: valid primary frozen dashboard, or synthetic Operations Overview. */
export async function getResolvedDashboard(opts?: ResolvedDashboardQuery) {
  const qs = new URLSearchParams();
  if (opts?.siteId) qs.set("site_id", opts.siteId);
  if (opts?.hours != null && opts.hours > 0) qs.set("hours", String(opts.hours));
  const q = qs.toString();
  return apiFetch<DashboardLiveDTO>(`/dashboards/resolved-live${q ? `?${q}` : ""}`);
}

export async function getEnterpriseDashboard() {
  return getResolvedDashboard();
}

export async function resetDashboardDefaultLayout(id: string) {
  return apiFetch<DashboardReadDTO>(`/dashboards/${id}/reset-default-layout`, { method: "POST" });
}

export async function getEnterpriseSiteObjectCounts(params?: { page?: number; page_size?: number }) {
  const qs = new URLSearchParams();
  if (params?.page != null) qs.set("page", String(params.page));
  if (params?.page_size != null) qs.set("page_size", String(params.page_size));
  const s = qs.toString();
  return apiFetch<EnterpriseSiteObjectCountsDTO>(`/enterprise-dashboard/site-object-counts${s ? `?${s}` : ""}`);
}

export type DataObjectSourceItem = {
  id: string;
  device_id: string;
  site_id: string;
  name: string;
  lifecycle_status: string;
  updated_at: string;
};

export type ResultObjectSourceItem = {
  id: string;
  workflow_id: string;
  result_object_name: string;
  site_id: string;
  created_at: string;
  latest_seen_at?: string | null;
};

export async function listDashboardDataObjectSources(siteId: string) {
  return apiFetch<{ items: DataObjectSourceItem[] }>(
    `/dashboards/sources/data-objects?site_id=${encodeURIComponent(siteId)}`,
  );
}

export async function listDashboardResultObjectSources(siteId: string) {
  return apiFetch<{ items: ResultObjectSourceItem[] }>(
    `/dashboards/sources/result-objects?site_id=${encodeURIComponent(siteId)}`,
  );
}

export type LatestDeviceStateSourceItem = {
  id: string;
  site_id: string;
  endpoint_id: string;
  resolved_device_id: string;
  object_name: string;
  updated_at: string;
  device_label?: string | null;
  endpoint_name?: string | null;
  /** Registered device name when the endpoint is linked to Manage Devices. */
  device_name?: string | null;
};

export type ResolvedDeviceCollectionSourceItem = {
  site_id: string;
  endpoint_id: string;
  endpoint_name?: string | null;
  object_name: string;
  latest_updated_at?: string | null;
  resolved_device_count: number;
  /** Linked device name when `endpoints.device_endpoint_id` is set. */
  device_name?: string | null;
  /** Scrubber-style title (output object name or "{device} Pipeline"). */
  pipeline_label?: string | null;
};

export type ResolvedDeviceCollectionRuntimeItem = {
  latest_device_state_id: string;
  resolved_device_id: string;
  device_label?: string | null;
  device_type?: string | null;
  lifecycle_status: string;
  health_status?: string | null;
  last_event_ts?: string | null;
  location_json?: Record<string, unknown> | null;
  identity_json?: Record<string, unknown>;
  display_json?: Record<string, unknown>;
  kpi_json?: Record<string, unknown>;
  health_json?: Record<string, unknown> | null;
  updated_at?: string;
  scrubbed_event_id?: string | null;
};

export type ResolvedDeviceCollectionRuntimeResponse = {
  items: ResolvedDeviceCollectionRuntimeItem[];
  summary: Record<string, unknown>;
  rollups?: Record<string, unknown>;
  trends?: Record<string, unknown>;
  next_cursor?: string | null;
};

export async function listDashboardLatestDeviceStateSources(siteId: string) {
  return apiFetch<{ items: LatestDeviceStateSourceItem[] }>(
    `/dashboards/sources/latest-device-states?site_id=${encodeURIComponent(siteId)}`,
  );
}

export async function listDashboardResolvedDeviceCollectionSources(siteId: string) {
  const qs = new URLSearchParams({
    site_id: siteId,
    limit: "500",
  });
  return apiFetch<{ items: ResolvedDeviceCollectionSourceItem[] }>(
    `/dashboards/sources/resolved-device-collections?${qs.toString()}`,
  );
}

export async function fetchResolvedDeviceCollection(params: {
  siteId: string;
  endpointId: string;
  objectName: string;
  limit?: number;
  cursor?: string;
  lifecycleStatus?: string;
  healthStatus?: string;
  deviceType?: string;
  /** When true, API omits rows without lat/lon and sets summary.excluded_missing_location. */
  requireLocation?: boolean;
}) {
  const query = new URLSearchParams();
  query.set("site_id", params.siteId);
  query.set("endpoint_id", params.endpointId);
  query.set("object_name", params.objectName);
  query.set("limit", String(params.limit ?? 500));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.lifecycleStatus) query.set("lifecycle_status", params.lifecycleStatus);
  if (params.healthStatus) query.set("health_status", params.healthStatus);
  if (params.deviceType) query.set("device_type", params.deviceType);
  if (params.requireLocation) query.set("require_location", "true");
  return apiFetch<ResolvedDeviceCollectionRuntimeResponse>(
    `/dashboards/runtime/resolved-device-collection?${query.toString()}`,
    { cache: "no-store" },
  );
}

export type MapEligibleItem = {
  source_type: string;
  source_id: string;
  name: string;
  lifecycle_status: string;
  updated_at: string | null;
};

export async function listMapEligibleObjects(siteId: string) {
  return apiFetch<{ items: MapEligibleItem[] }>(
    `/dashboards/map-runtime/eligible?site_id=${encodeURIComponent(siteId)}`,
  );
}

/** Site markers for custom UIs; `light=true` (default) omits KPI blobs — use `getMapObjectDetail` per feature. */
export async function getMapRuntimeMarkers(params: {
  siteId: string;
  latitudeField?: string;
  longitudeField?: string;
  kpiFields?: string[];
  excludedSourceIds?: string[];
  light?: boolean;
}) {
  const qs = new URLSearchParams();
  qs.set("site_id", params.siteId);
  qs.set("latitude_field", params.latitudeField ?? "gps.lat");
  qs.set("longitude_field", params.longitudeField ?? "gps.lon");
  if (params.kpiFields?.length) qs.set("kpi_fields", params.kpiFields.join(","));
  if (params.excludedSourceIds?.length) qs.set("excludedSourceIds", params.excludedSourceIds.join(","));
  qs.set("light", params.light === false ? "false" : "true");
  return apiFetch<{ markers: Record<string, unknown>[] }>(`/dashboards/map-runtime/markers?${qs.toString()}`, {
    cache: "no-store",
  });
}

/** POST unified marker query — dashboard map widgets must use this instead of embedded markers in live payloads. */
export type MapMarkersQueryBody = {
  site_id: string;
  latitude_field?: string;
  longitude_field?: string;
  kpi_fields?: string[];
  excluded_source_ids?: string[];
  device_ids?: string[];
  title_field?: string | null;
  health_field?: string | null;
  light?: boolean;
  mode: "auto" | "manual" | "single";
  included_sources?: unknown[] | null;
  single_source_type?: string | null;
  single_source_id?: string | null;
};

export type MapMarkersQueryResponse = {
  markers: Record<string, unknown>[];
  map_init: Record<string, unknown> | null;
};

export async function postMapMarkersQuery(body: MapMarkersQueryBody) {
  return apiFetch<MapMarkersQueryResponse>(`/dashboards/map-runtime/markers/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getMapObjectDetail(params: {
  siteId: string;
  sourceType: string;
  sourceId: string;
  displayFieldPaths?: string[];
  kpiKeys?: string[];
  trendScope?: "resolved_device" | "endpoint" | "site";
}) {
  const qs = new URLSearchParams();
  qs.set("site_id", params.siteId);
  qs.set("source_type", params.sourceType);
  qs.set("source_id", params.sourceId);
  if (params.kpiKeys?.length) params.kpiKeys.forEach((k) => qs.append("kpiKeys", k));
  if (params.displayFieldPaths?.length)
    params.displayFieldPaths.forEach((k) => qs.append("displayFieldPaths", k));
  if (params.trendScope) qs.set("trendScope", params.trendScope);
  return apiFetch<{ detail: Record<string, unknown> }>(`/dashboards/map-runtime/detail?${qs.toString()}`, {
    cache: "no-store",
  });
}

/** Expanded map intelligence (devices, freshness, aggregates, trend_context). */
export async function getMapIntelligenceExpanded(params: {
  siteId: string;
  endpointId?: string | null;
  mode?: "runtime" | "historical";
  page?: number;
  limit?: number;
  kpiKeys?: string[];
}) {
  const qs = new URLSearchParams();
  qs.set("site_id", params.siteId);
  if (params.endpointId) qs.set("endpoint_id", params.endpointId);
  qs.set("mode", params.mode ?? "runtime");
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(params.limit ?? 25));
  (params.kpiKeys ?? []).forEach((k) => qs.append("kpiKeys", k));
  return apiFetch<Record<string, unknown>>(`/dashboards/map-runtime/intelligence/expanded?${qs.toString()}`, {
    cache: "no-store",
  });
}

/** Historical polyline from scrubbed_events (footprint + gap markers). */
export async function getMapIntelligencePath(params: {
  siteId: string;
  entityId: string;
  from?: string;
  to?: string;
  expectedFrequencySec?: number;
}) {
  const qs = new URLSearchParams();
  qs.set("site_id", params.siteId);
  qs.set("entityId", params.entityId);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.expectedFrequencySec != null) {
    qs.set("expected_frequency_sec", String(params.expectedFrequencySec));
  }
  return apiFetch<Record<string, unknown>>(`/dashboards/map-runtime/intelligence/path?${qs.toString()}`, {
    cache: "no-store",
  });
}
