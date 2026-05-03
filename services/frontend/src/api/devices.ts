import { apiFetch } from "./client";

/** Mirrors API `DeviceEndpointNested` + `DeviceRead` list fields used by the UI. */
export type DeviceEndpointList = {
  id: string;
  protocol: string;
  config: Record<string, unknown>;
  polling_interval_seconds: number;
  is_active: boolean;
  activation_status?: string;
  first_payload_at?: string | null;
  last_payload_at?: string | null;
  last_error?: string | null;
  validation_status?: string | null;
  validation_detail?: string | null;
  last_verified_at?: string | null;
} | null;

export type DeviceRead = {
  id: string;
  site_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_active: boolean;
  polling_enabled: boolean;
  last_seen_at?: string | null;
  /** Liveness FSM; worker may update less often than ingest — UI uses displayLivenessState. */
  current_liveness_state?: string;
  last_state_changed_at?: string | null;
  expected_interval_seconds?: number;
  /** Same fields as device_liveness worker thresholds (defaults 120 / 300). */
  late_threshold_seconds?: number;
  offline_threshold_seconds?: number;
  endpoint: DeviceEndpointList;
  /** Operational lineage (API-evaluated); not lifecycle operational_status. */
  footprint_operational_status?: string | null;
  footprint_recommendation_code?: string | null;
  footprint_recommendation_message?: string | null;
};

/** Mirrors GET /devices/{id}/footprint JSON (v1). */
export type DeviceFootprintRead = {
  device: {
    device_id: string;
    resolved_device_id: string | null;
    site_id: string;
    activation_status: string | null;
  };
  endpoint: {
    endpoint_id: string;
    name: string;
    status: string | null;
    expected_frequency_sec: number;
  } | null;
  ingestion: {
    last_ingested_at: string | null;
    ingest_age_sec: number | null;
    expected_frequency_sec: number;
    stale_after_sec: number;
  };
  scrubber: { associated: boolean; last_output_at: string | null; status: string };
  workflow: { associated: boolean; workflows: unknown[] };
  dashboard: { count: number; dashboards: unknown[] };
  trends: {
    device_trend_available?: boolean;
    endpoint_rollup_available?: boolean;
    records_1h?: unknown;
    records_24h?: unknown;
  };
  status: string;
  recommendation: { code: string; message: string };
};

export async function getDevice(deviceId: string) {
  return apiFetch<DeviceRead>(`/devices/${encodeURIComponent(deviceId)}`);
}

export async function getDeviceFootprint(deviceId: string) {
  return apiFetch<DeviceFootprintRead>(`/devices/${encodeURIComponent(deviceId)}/footprint`);
}

export async function listDevices(params?: { q?: string; site_id?: string }): Promise<DeviceRead[]> {
  const sp = new URLSearchParams();
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.site_id) sp.set("site_id", params.site_id);
  const qs = sp.toString();
  const path = qs ? `/devices?${qs}` : "/devices";
  const data = await apiFetch<{ items: DeviceRead[] }>(path);
  return data?.items ?? [];
}

export async function createDevice(body: { name: string; description?: string | null; site_id: string }) {
  return apiFetch<DeviceRead>("/devices", {
    method: "POST",
    json: {
      name: body.name,
      description: body.description ?? null,
      site_id: body.site_id,
    },
  });
}

export async function updateDevice(
  deviceId: string,
  body: { name?: string; description?: string | null; site_id?: string },
) {
  return apiFetch<DeviceRead>(`/devices/${deviceId}`, { method: "PATCH", json: body });
}
