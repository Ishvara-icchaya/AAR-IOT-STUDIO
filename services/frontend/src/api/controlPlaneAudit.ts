import { apiFetch } from "./client";

export type ControlPlaneAuditEventRead = {
  id: string;
  customer_id: string;
  site_id: string | null;
  actor_user_id: string | null;
  action_type: string;
  resource_type: string;
  resource_id: string | null;
  correlation_id: string | null;
  payload_json: Record<string, unknown> | null;
  created_at: string;
};

export async function listControlPlaneAuditEvents(params?: {
  site_id?: string;
  action_type?: string;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.site_id) sp.set("site_id", params.site_id);
  if (params?.action_type?.trim()) sp.set("action_type", params.action_type.trim());
  if (params?.limit != null) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return apiFetch<{ items: ControlPlaneAuditEventRead[] }>(qs ? `/audit/events?${qs}` : "/audit/events");
}
