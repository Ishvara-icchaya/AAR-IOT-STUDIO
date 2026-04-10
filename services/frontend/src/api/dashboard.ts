import { apiFetch } from "@/api/client";
import type { DashboardLayoutV1, DashboardListItemDTO, DashboardLiveDTO, DashboardReadDTO } from "@/types/dashboard";

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

export async function getEnterpriseDashboard() {
  return apiFetch<DashboardLiveDTO>("/enterprise-dashboard");
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
  return apiFetch<{ detail: Record<string, unknown> }>(`/dashboards/map-runtime/detail?${qs.toString()}`);
}
