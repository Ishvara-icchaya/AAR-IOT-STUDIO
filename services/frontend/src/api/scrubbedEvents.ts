import { apiFetch } from "@/api/client";

export type ScrubbedEventRead = {
  id: string;
  customer_id: string;
  site_id: string;
  endpoint_id: string;
  resolved_device_id: string;
  object_name: string;
  event_ts: string;
  ingested_at: string;
  identity_json: Record<string, unknown>;
  display_json: Record<string, unknown>;
  kpi_json: Record<string, unknown>;
  health_json: Record<string, unknown> | null;
  location_json: Record<string, unknown> | null;
  payload_ref: string | null;
  created_at: string;
};

export type ScrubbedEventListResponse = {
  items: ScrubbedEventRead[];
  next_cursor: string | null;
};

export async function listEndpointScrubbedEvents(
  endpointId: string,
  opts?: { limit?: number; cursor?: string | null },
): Promise<ScrubbedEventListResponse> {
  const qs = new URLSearchParams();
  if (opts?.limit != null) qs.set("limit", String(opts.limit));
  if (opts?.cursor?.trim()) qs.set("cursor", opts.cursor.trim());
  const q = qs.toString();
  const res = await apiFetch<ScrubbedEventListResponse>(
    `/endpoints/${encodeURIComponent(endpointId)}/scrubbed-events${q ? `?${q}` : ""}`,
  );
  return res ?? { items: [], next_cursor: null };
}
