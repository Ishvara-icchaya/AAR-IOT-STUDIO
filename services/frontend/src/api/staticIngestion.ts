import { apiFetch } from "@/api/client";

export type StaticIngestionListItem = {
  id: string;
  site_id: string;
  name: string;
  description: string | null;
  end_at: string | null;
  updated_at: string;
};

export type StaticIngestionRead = StaticIngestionListItem & {
  customer_id: string;
  schedule_json: Record<string, unknown>;
  payload_json: Record<string, unknown>;
  created_at: string;
};

export async function listStaticIngestions(siteId: string, params?: { q?: string; active_only?: boolean }) {
  const qs = new URLSearchParams({ site_id: siteId });
  if (params?.q?.trim()) qs.set("q", params.q.trim());
  if (params?.active_only) qs.set("active_only", "true");
  return apiFetch<{ items: StaticIngestionListItem[] }>(`/static-ingestions?${qs.toString()}`);
}

export async function getStaticIngestion(id: string) {
  return apiFetch<StaticIngestionRead>(`/static-ingestions/${id}`);
}

export type StaticIngestionValidateBody = {
  site_id: string;
  name: string;
  description?: string | null;
  end_at: string | null;
  schedule_json: Record<string, unknown>;
  payload_json: Record<string, unknown>;
};

export async function validateStaticIngestion(body: StaticIngestionValidateBody) {
  return apiFetch<{ valid: boolean; errors: string[] }>(`/static-ingestions/validate`, {
    method: "POST",
    json: body,
  });
}

export async function createStaticIngestion(body: StaticIngestionValidateBody) {
  return apiFetch<StaticIngestionRead>(`/static-ingestions`, { method: "POST", json: body });
}

/** Full update — backend re-validates merged row. */
export type StaticIngestionUpdateBody = {
  name: string;
  description?: string | null;
  end_at: string | null;
  schedule_json: Record<string, unknown>;
  payload_json: Record<string, unknown>;
};

export async function updateStaticIngestion(id: string, body: StaticIngestionUpdateBody) {
  return apiFetch<StaticIngestionRead>(`/static-ingestions/${id}`, { method: "PUT", json: body });
}
