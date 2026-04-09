import { apiFetch } from "@/api/client";

/** Unified observability envelope; protocol-specific fields are under `details`. */
export type DeviceEndpointObservability = {
  last_raw_ingested_at: string | null;
  /** Logical protocol: mqtt | rest | coap | websocket */
  protocol: string;
  details: Record<string, unknown>;
};

export type DeviceEndpointRead = {
  id: string;
  device_id: string;
  protocol: string;
  config: Record<string, unknown>;
  polling_interval_seconds: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_verified_at: string | null;
  validation_status: string | null;
  validation_detail: string | null;
  activation_status: string;
  first_payload_at: string | null;
  last_payload_at: string | null;
  last_error: string | null;
};

export type DeviceEndpointGetResponse = {
  defined: boolean;
  endpoint: DeviceEndpointRead | null;
  observability: DeviceEndpointObservability | null;
};

export type DeviceEndpointValidateResponse = {
  validation_status: string;
  validation_detail: string;
  last_verified_at: string;
  observability: DeviceEndpointObservability;
  endpoint: DeviceEndpointRead;
};

export function fetchDeviceEndpoint(deviceId: string) {
  return apiFetch<DeviceEndpointGetResponse>(
    `/device-endpoints?device_id=${encodeURIComponent(deviceId)}`,
  );
}

export function validateDeviceEndpoint(deviceId: string) {
  return apiFetch<DeviceEndpointValidateResponse>("/device-endpoints/validate", {
    method: "POST",
    json: { device_id: deviceId },
  });
}
