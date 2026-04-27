import { apiFetch } from "@/api/client";
import type {
  DashboardLayoutV1,
  DashboardListItemDTO,
  DashboardLiveDTO,
  DashboardReadDTO,
  EnterpriseSiteObjectCountsDTO,
} from "@/types/dashboard";

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
};

export async function listDashboardLatestDeviceStateSources(siteId: string) {
  return apiFetch<{ items: LatestDeviceStateSourceItem[] }>(
    `/dashboards/sources/latest-device-states?site_id=${encodeURIComponent(siteId)}`,
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
}) {
  const qs = new URLSearchParams();
  qs.set("site_id", params.siteId);
  qs.set("source_type", params.sourceType);
  qs.set("source_id", params.sourceId);
  if (params.kpiKeys?.length) params.kpiKeys.forEach((k) => qs.append("kpiKeys", k));
  if (params.displayFieldPaths?.length)
    params.displayFieldPaths.forEach((k) => qs.append("displayFieldPaths", k));
  return apiFetch<{ detail: Record<string, unknown> }>(`/dashboards/map-runtime/detail?${qs.toString()}`, {
    cache: "no-store",
  });
}
