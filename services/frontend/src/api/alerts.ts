import { apiFetch } from "@/api/client";

export type AlertRow = {
  id: string;
  customer_id: string;
  site_id: string | null;
  /** Tenant site for the registered device (ingest context); preferred for display over ``site_id`` when set. */
  platform_site_id?: string | null;
  platform_site_name?: string | null;
  device_id: string | null;
  category: string;
  severity: string;
  title: string;
  message: string;
  source_component: string | null;
  source_object_type: string | null;
  source_object_id: string | null;
  trace_id: string | null;
  acknowledged_by_user_id: string | null;
  acknowledged_at: string | null;
  created_at: string;
  acknowledged: boolean;
};

export type AlertListResponse = { items: AlertRow[]; total: number };

export type AlertAcknowledgeAllResponse = { acknowledged_count: number };

export type AlertSummary = {
  critical: number;
  warning: number;
  info: number;
  total_unacknowledged: number;
  by_site: Record<string, number>;
  has_critical: boolean;
  critical_recent_count: number;
};

export async function listAlerts(params?: {
  site_id?: string;
  severity?: string;
  category?: string;
  acknowledged?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.site_id) qs.set("site_id", params.site_id);
  if (params?.severity) qs.set("severity", params.severity);
  if (params?.category) qs.set("category", params.category);
  if (params?.acknowledged !== undefined) qs.set("acknowledged", String(params.acknowledged));
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const s = qs.toString();
  return apiFetch<AlertListResponse>(`/alerts${s ? `?${s}` : ""}`);
}

export async function getAlert(id: string) {
  return apiFetch<AlertRow>(`/alerts/${id}`);
}

export async function acknowledgeAlert(id: string) {
  return apiFetch<AlertRow>(`/alerts/${id}/acknowledge`, { method: "POST" });
}

/** Acknowledge up to ``limit`` unacknowledged alerts matching the same filters as ``listAlerts`` (omit ``acknowledged``). */
export async function acknowledgeAllAlerts(params?: {
  site_id?: string;
  severity?: string;
  category?: string;
  search?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.site_id) qs.set("site_id", params.site_id);
  if (params?.severity) qs.set("severity", params.severity);
  if (params?.category) qs.set("category", params.category);
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  if (params?.limit != null) qs.set("limit", String(params.limit));
  const s = qs.toString();
  /* Empty JSON body: some stacks require a Content-Length on POST; query params carry filters. */
  return apiFetch<AlertAcknowledgeAllResponse>(`/alerts/acknowledge-all${s ? `?${s}` : ""}`, { method: "POST", json: {} });
}

export async function getAlertsSummary() {
  return apiFetch<AlertSummary>("/alerts/summary/unacknowledged");
}
