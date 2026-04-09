import { apiFetch } from "@/api/client";

export type PublishedServiceRow = {
  id: string;
  customer_id: string;
  site_id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_object_id: string;
  source_object_name: string;
  publish_protocol: string;
  target_config_json: Record<string, unknown>;
  status: string;
  last_published_at: string | null;
  last_error_message: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PublishedServiceListResponse = { items: PublishedServiceRow[] };

export type PublishedTargetDefaults = {
  rest_target_config_json: Record<string, unknown>;
  mqtt_target_config_json: Record<string, unknown>;
};

export type PublishedServiceDetailResponse = {
  service: PublishedServiceRow;
  delivery_logs: DeliveryLogRow[];
};

export type DeliveryLogRow = {
  id: string;
  published_service_id: string;
  source_event_id: string | null;
  status: string;
  response_code: string | null;
  response_message: string | null;
  trace_id: string | null;
  published_at: string;
};

export async function fetchPublishedTargetDefaults() {
  return apiFetch<PublishedTargetDefaults>("/published-services/defaults/targets");
}

export async function listPublishedServices(params?: {
  site_id?: string;
  status?: string;
  publish_protocol?: string;
  search?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.site_id) qs.set("site_id", params.site_id);
  if (params?.status) qs.set("status", params.status);
  if (params?.publish_protocol) qs.set("publish_protocol", params.publish_protocol);
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  const s = qs.toString();
  return apiFetch<PublishedServiceListResponse>(`/published-services${s ? `?${s}` : ""}`);
}

export async function getPublishedService(id: string) {
  return apiFetch<PublishedServiceRow>(`/published-services/${id}`);
}

export async function getPublishedServiceDetail(id: string, limit = 100) {
  return apiFetch<PublishedServiceDetailResponse>(
    `/published-services/${id}/detail?limit=${limit}`,
  );
}

export async function createPublishedService(body: Record<string, unknown>) {
  return apiFetch<PublishedServiceRow>("/published-services", { method: "POST", json: body });
}

export async function updatePublishedService(id: string, body: Record<string, unknown>) {
  return apiFetch<PublishedServiceRow>(`/published-services/${id}`, { method: "PUT", json: body });
}

export async function deletePublishedService(id: string) {
  return apiFetch<null>(`/published-services/${id}`, { method: "DELETE" });
}

export async function startPublishedService(id: string) {
  return apiFetch<PublishedServiceRow>(`/published-services/${id}/start`, { method: "POST" });
}

export async function stopPublishedService(id: string) {
  return apiFetch<PublishedServiceRow>(`/published-services/${id}/stop`, { method: "POST" });
}

export async function restartPublishedService(id: string) {
  return apiFetch<PublishedServiceRow>(`/published-services/${id}/restart`, { method: "POST" });
}

export async function testPublishedService(id: string, trace_id?: string) {
  const qs = trace_id ? `?trace_id=${encodeURIComponent(trace_id)}` : "";
  return apiFetch<{
    ok: boolean;
    status: string;
    response_code: string | null;
    response_message: string | null;
    trace_id: string | null;
  }>(`/published-services/${id}/test${qs}`, { method: "POST" });
}

export async function listDeliveryLogs(serviceId: string, limit = 100) {
  return apiFetch<{ items: DeliveryLogRow[] }>(
    `/published-services/${serviceId}/delivery-logs?limit=${limit}`,
  );
}

export async function listPsDataObjectSources(siteId: string) {
  return apiFetch<{ items: { id: string; name: string; device_id: string; site_id: string; lifecycle_status: string }[] }>(
    `/published-services/sources/data-objects?site_id=${encodeURIComponent(siteId)}`,
  );
}

export async function listPsResultObjectSources(siteId: string) {
  return apiFetch<{
    items: { id: string; workflow_id: string; result_object_name: string; site_id: string }[];
  }>(`/published-services/sources/result-objects?site_id=${encodeURIComponent(siteId)}`);
}
