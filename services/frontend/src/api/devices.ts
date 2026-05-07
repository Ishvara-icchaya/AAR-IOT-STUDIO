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
  /** Declared firmware string (opaque); not protocol identity. */
  firmware_version?: string | null;
  firmware_channel?: string;
  ota_supported?: boolean;
  rollback_supported?: boolean;
  /** Current device version label (e.g. "1"); not the UUID primary key. */
  device_version?: string;
  version_status?: string;
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
  workflow: {
    associated: boolean;
    workflows: {
      id: string;
      name: string;
      lifecycle_status: string;
      is_published: boolean;
      site_id?: string | null;
      definition_version?: number;
    }[];
  };
  dashboard: {
    count: number;
    dashboards: { id: string; name: string; status: string; site_id?: string | null }[];
  };
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

/** GET /devices/{id}/version-lineage — timeline + KPI map (bootstrap: current cut only). */
export type DeviceVersionLineageVersion = {
  id: string;
  version_label: string;
  is_current: boolean;
  recorded_at: string | null;
  trigger_code: string;
  superseded_by_label: string | null;
  ota_external_ref?: string | null;
  metadata: Record<string, unknown>;
  event_type?: string | null;
  source_type?: string | null;
  status?: string | null;
  target_device_version_id?: string | null;
  previous_device_version_id?: string | null;
};

export type DeviceVersionLineageRead = {
  device_id: string;
  versions: DeviceVersionLineageVersion[];
  kpi_metric_keys: string[];
  kpi_by_version: Record<string, Record<string, unknown>>;
};

export async function getDeviceVersionLineage(deviceId: string) {
  return apiFetch<DeviceVersionLineageRead>(`/devices/${encodeURIComponent(deviceId)}/version-lineage`);
}

/** Deep link: register page with version history drawer open. */
export function deviceRegisterVersionHistoryUrl(
  deviceId: string,
  opts?: { compareA?: string; compareB?: string },
) {
  const sp = new URLSearchParams();
  sp.set("device", deviceId);
  sp.set("versionHistory", "1");
  if (opts?.compareA?.trim()) sp.set("compareA", opts.compareA.trim());
  if (opts?.compareB?.trim()) sp.set("compareB", opts.compareB.trim());
  return `/devices/register?${sp.toString()}#registered-devices-table`;
}

/** Deep link: lineage page with footprint modal (and optional version drawer / KPI compare). */
export function deviceLineageFootprintUrl(
  deviceId: string,
  opts?: { versionHistory?: boolean; kpiAnchor?: boolean; compareA?: string; compareB?: string },
) {
  const sp = new URLSearchParams();
  sp.set("device", deviceId);
  sp.set("footprint", "1");
  if (opts?.versionHistory) sp.set("versionHistory", "1");
  if (opts?.compareA?.trim()) sp.set("compareA", opts.compareA.trim());
  if (opts?.compareB?.trim()) sp.set("compareB", opts.compareB.trim());
  let path = `/devices/lineage?${sp.toString()}`;
  if (opts?.kpiAnchor) path += "#device-lineage-kpi-heading";
  return path;
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

/** POST /devices — Phase 1 v8 declared readiness / firmware (optional beyond identity). */
export type DeviceCreateBody = {
  name: string;
  site_id: string;
  description?: string | null;
  icon?: string | null;
  expected_interval_seconds?: number | null;
  late_threshold_seconds?: number | null;
  offline_threshold_seconds?: number | null;
  firmware_version?: string | null;
  firmware_channel?: string | null;
  ota_supported?: boolean | null;
  rollback_supported?: boolean | null;
};

/** PATCH /devices/{id} */
export type DevicePatchBody = {
  name?: string;
  description?: string | null;
  site_id?: string;
  is_active?: boolean;
  polling_enabled?: boolean;
  expected_interval_seconds?: number | null;
  late_threshold_seconds?: number | null;
  offline_threshold_seconds?: number | null;
  firmware_version?: string | null;
  firmware_channel?: string | null;
  ota_supported?: boolean | null;
  rollback_supported?: boolean | null;
  device_version?: string | null;
  version_status?: string | null;
};

export async function createDevice(body: DeviceCreateBody) {
  return apiFetch<DeviceRead>("/devices", {
    method: "POST",
    json: body,
  });
}

export async function updateDevice(deviceId: string, body: DevicePatchBody) {
  return apiFetch<DeviceRead>(`/devices/${deviceId}`, { method: "PATCH", json: body });
}

export type DeviceImportCommitRow = {
  line: number;
  name: string;
  site_id: string;
  description?: string | null;
  icon?: string | null;
  is_active?: boolean | null;
  polling_enabled?: boolean | null;
  expected_interval_seconds?: number | null;
  late_threshold_seconds?: number | null;
  offline_threshold_seconds?: number | null;
  firmware_version?: string | null;
  firmware_channel?: string | null;
  ota_supported?: boolean | null;
  rollback_supported?: boolean | null;
  device_version?: string | null;
  version_status?: string | null;
};

export type DeviceImportValidateResponse = {
  ok: boolean;
  row_errors: { line: number; message: string }[];
  validated_row_count: number;
};

export type DeviceImportCommitResponse = {
  audit_id: string;
  status: string;
  row_count: number;
  success_count: number;
  failure_count: number;
  failures: { line: number; message: string }[];
};

export async function validateDeviceImportRows(rows: DeviceImportCommitRow[], sourceLabel?: string | null) {
  return apiFetch<DeviceImportValidateResponse>("/devices/import/validate", {
    method: "POST",
    json: { rows, source_label: sourceLabel ?? null },
  });
}

export async function commitDeviceImportRows(rows: DeviceImportCommitRow[], sourceLabel?: string | null) {
  return apiFetch<DeviceImportCommitResponse>("/devices/import/commit", {
    method: "POST",
    json: { rows, source_label: sourceLabel ?? null },
  });
}
