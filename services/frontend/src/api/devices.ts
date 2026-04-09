import { apiFetch } from "./client";

export type DeviceRead = {
  id: string;
  site_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_active: boolean;
  polling_enabled: boolean;
  endpoint: unknown | null;
};

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
