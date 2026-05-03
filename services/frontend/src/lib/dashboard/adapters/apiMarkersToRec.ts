/**
 * Convert lightweight API marker objects → MapWidget marker records for deck pipeline.
 * API shape matches map_marker_to_light (+ source ids).
 */
export type MarkerRec = {
  latitude: number;
  longitude: number;
  display_name?: string;
  device_name?: string;
  site_name?: string;
  kpis?: Record<string, unknown>;
  health_status?: string;
  health_message?: string;
  blink_mode?: string;
  updated_at?: string;
  source_type?: string;
  source_id?: string;
  resolved_device_id?: string;
  endpoint_id?: string;
  heading_deg?: number;
  mobility_type?: string;
  marker_hue?: number;
  marker_group_index?: number;
  device_id?: string;
};

export function apiMarkersToMarkerRecs(markers: Record<string, unknown>[]): MarkerRec[] {
  const out: MarkerRec[] = [];
  for (const raw of markers) {
    const lat = raw.latitude;
    const lon = raw.longitude;
    if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) {
      continue;
    }
    out.push({
      latitude: lat,
      longitude: lon,
      display_name: typeof raw.display_name === "string" ? raw.display_name : undefined,
      device_name: typeof raw.device_name === "string" ? raw.device_name : undefined,
      site_name: typeof raw.site_name === "string" ? raw.site_name : undefined,
      health_status: typeof raw.health_status === "string" ? raw.health_status : undefined,
      health_message: typeof raw.health_message === "string" ? raw.health_message : undefined,
      blink_mode: typeof raw.blink_mode === "string" ? raw.blink_mode : undefined,
      updated_at: typeof raw.updated_at === "string" ? raw.updated_at : undefined,
      source_type: typeof raw.source_type === "string" ? raw.source_type : undefined,
      source_id: typeof raw.source_id === "string" ? raw.source_id : undefined,
      resolved_device_id:
        typeof raw.resolved_device_id === "string" ? raw.resolved_device_id : undefined,
      endpoint_id: typeof raw.endpoint_id === "string" ? raw.endpoint_id : undefined,
      heading_deg: typeof raw.heading_deg === "number" ? raw.heading_deg : undefined,
      mobility_type: typeof raw.mobility_type === "string" ? raw.mobility_type : undefined,
      marker_hue: typeof raw.marker_hue === "number" && Number.isFinite(raw.marker_hue) ? raw.marker_hue : undefined,
      marker_group_index:
        typeof raw.marker_group_index === "number" && Number.isFinite(raw.marker_group_index)
          ? raw.marker_group_index
          : undefined,
      device_id: typeof raw.device_id === "string" ? raw.device_id : undefined,
    });
  }
  return out;
}
