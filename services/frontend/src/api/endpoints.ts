import { apiFetch } from "@/api/client";

export type EndpointRead = {
  id: string;
  customer_id: string;
  site_id: string;
  endpoint_name: string;
  protocol: string;
  object_name: string;
  lifecycle_status: string;
  primary_device_key_fields: string[] | null;
  device_label_fields?: string[] | null;
  location_fields?: Record<string, unknown> | unknown[] | null;
  auth_config?: Record<string, unknown> | null;
  device_endpoint_id?: string | null;
  sample_payload?: Record<string, unknown> | unknown[] | null;
  sample_ingested_at?: string | null;
  identity_published_at?: string | null;
  identity_draft?: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type EndpointCreateBody = {
  site_id: string;
  endpoint_name: string;
  protocol: string;
  object_name: string;
  primary_device_key_fields?: string[] | null;
  device_label_fields?: string[] | null;
  location_fields?: Record<string, unknown> | unknown[] | null;
  auth_config?: Record<string, unknown> | null;
  device_endpoint_id?: string | null;
  enabled?: boolean;
};

export type EndpointUpdateBody = Partial<EndpointCreateBody> & {
  identity_draft?: Record<string, unknown> | null;
};

export type PayloadFieldEntry = { path: string; type: string; sample: unknown; section?: string | null };

export async function listEndpoints(params?: { site_id?: string; q?: string }) {
  const qs = new URLSearchParams();
  if (params?.site_id) qs.set("site_id", params.site_id);
  if (params?.q) qs.set("q", params.q);
  const s = qs.toString();
  return apiFetch<{ items: EndpointRead[] }>(`/endpoints${s ? `?${s}` : ""}`);
}

export async function createEndpoint(body: EndpointCreateBody) {
  return apiFetch<EndpointRead>("/endpoints", { method: "POST", json: body });
}

export async function getEndpoint(id: string) {
  return apiFetch<EndpointRead>(`/endpoints/${encodeURIComponent(id)}`);
}

export async function updateEndpoint(id: string, body: EndpointUpdateBody) {
  return apiFetch<EndpointRead>(`/endpoints/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
}

export async function getEndpointSampleFieldMetadata(id: string) {
  return apiFetch<{ items: PayloadFieldEntry[] }>(
    `/endpoints/${encodeURIComponent(id)}/sample-field-metadata`,
  );
}

export async function publishEndpointIdentity(id: string) {
  return apiFetch<EndpointRead>(`/endpoints/${encodeURIComponent(id)}/publish-identity`, { method: "POST" });
}
