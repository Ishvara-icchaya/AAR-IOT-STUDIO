/**
 * Normalized view models for dashboard maps — lightweight feeds for GPU layers.
 * Heavy payloads stay out of the render path; detail loads on demand (click).
 */

export type MapPointVM = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  health_status: string;
  source_type?: string;
  source_id?: string;
  /** LDS markers: used for homogeneous cluster → endpoint trend popup */
  endpoint_id?: string;
  resolved_device_id?: string;
  updated_at?: string;
  /** Fleet / live map */
  heading_deg?: number | null;
  speed?: number | null;
};

export type MapProfile = "site" | "fleet";

export function healthToRgb(health: string | undefined): [number, number, number, number] {
  const s = (health ?? "").trim().toLowerCase();
  if (s === "red") return [239, 68, 68, 230];
  if (s === "yellow") return [234, 179, 8, 230];
  if (s === "green") return [34, 197, 94, 230];
  if (s === "offline") return [100, 116, 139, 230];
  return [148, 163, 184, 220];
}

export type MarkerLike = {
  latitude: number;
  longitude: number;
  display_name?: string;
  health_status?: string;
  source_type?: string;
  source_id?: string;
  endpoint_id?: string;
  resolved_device_id?: string;
  updated_at?: string;
  heading_deg?: number;
  speed_ms?: number;
  speed?: number;
};

export function toMapPointVM(m: MarkerLike, fallbackId: string): MapPointVM {
  return {
    id: String(m.source_id ?? fallbackId),
    latitude: m.latitude,
    longitude: m.longitude,
    label: String(m.display_name ?? "Object"),
    health_status: String(m.health_status ?? "").toLowerCase(),
    source_type: m.source_type,
    source_id: m.source_id,
    endpoint_id: typeof m.endpoint_id === "string" ? m.endpoint_id : undefined,
    resolved_device_id: typeof m.resolved_device_id === "string" ? m.resolved_device_id : undefined,
    updated_at: m.updated_at,
    heading_deg:
      typeof m.heading_deg === "number" && Number.isFinite(m.heading_deg) ? m.heading_deg : null,
    speed:
      typeof m.speed_ms === "number"
        ? m.speed_ms
        : typeof m.speed === "number"
          ? m.speed
          : null,
  };
}

export function markersToViewModels(
  markers: MarkerLike[],
  _profile: MapProfile,
): MapPointVM[] {
  return markers.map((m, i) => toMapPointVM(m, `m-${i}`));
}
