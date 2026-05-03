/**
 * Map transport types (contract: docs/MAP_RICH_POINT_AND_SEMANTICS_CONTRACT.md).
 * Display strings for live markers still come from API; semantics ladder is enforced server-side.
 */

export type RuntimeMapPoint = {
  latestDeviceStateId: string;
  resolvedDeviceId: string;
  endpointId: string;
  lng: number;
  lat: number;
  headingDeg?: number;
  /** Resolved label for map chrome after semantic ladder. */
  label?: string;
};

export type RichMapPointSource = "historical" | "trace" | "replay";

export type RichMapPoint = {
  scrubbedEventId: string;
  resolvedDeviceId: string;
  endpointId: string;
  eventTs: string;
  ingestedAt?: string;
  lng: number;
  lat: number;
  headingDeg?: number | null;
  label?: string | null;
  objectName?: string;
  health?: unknown;
  kpi?: unknown;
  display?: unknown;
  source: RichMapPointSource;
  /** When known, open map detail via latest_device_state. */
  latestDeviceStateId?: string | null;
};

export function parseRichMapPointsFromApi(rows: unknown): RichMapPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: RichMapPoint[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const lng = typeof o.lng === "number" ? o.lng : Number(o.lng);
    const lat = typeof o.lat === "number" ? o.lat : Number(o.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const sid = o.scrubbed_event_id;
    if (typeof sid !== "string" || !sid) continue;
    const src = o.source;
    const source: RichMapPoint["source"] =
      src === "trace" || src === "replay" ? src : "historical";
    const ldsRaw = o.latest_device_state_id;
    const latestDeviceStateId =
      typeof ldsRaw === "string" && ldsRaw.trim() ? ldsRaw.trim() : null;
    out.push({
      scrubbedEventId: sid,
      resolvedDeviceId: String(o.resolved_device_id ?? ""),
      endpointId: String(o.endpoint_id ?? ""),
      eventTs: String(o.event_ts ?? ""),
      ingestedAt: typeof o.ingested_at === "string" ? o.ingested_at : undefined,
      lng,
      lat,
      headingDeg: typeof o.heading_deg === "number" ? o.heading_deg : null,
      label: typeof o.label === "string" ? o.label : null,
      objectName: typeof o.object_name === "string" ? o.object_name : undefined,
      health: o.health,
      kpi: o.kpi,
      display: o.display,
      source,
      latestDeviceStateId,
    });
  }
  return out;
}
