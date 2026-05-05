/** Map widget `config.mapTrackMode` + rows/device ids — used by builder and summaries. */

export function mapEndpointRows(c: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(c.mapEndpointGroupEntries) ? (c.mapEndpointGroupEntries as Record<string, unknown>[]) : [];
}

export function mapEndpointRowComplete(r: Record<string, unknown>): boolean {
  return Boolean(
    String(r.endpointId ?? r.endpoint_id ?? "").trim() && String(r.objectName ?? r.object_name ?? "").trim(),
  );
}

export function derivedMapTrackMode(c: Record<string, unknown>): "site" | "devices" | "endpoint_groups" {
  const rows = mapEndpointRows(c);
  if (rows.some(mapEndpointRowComplete)) return "endpoint_groups";
  if (String(c.mapTrackMode ?? "").trim() === "endpoint_groups" && rows.length > 0) return "endpoint_groups";
  const dev = c.mapDeviceIds as string[] | undefined;
  if (Array.isArray(dev) && dev.length > 0) return "devices";
  return "site";
}

export function normalizeMapEndpointEntries(rows: Record<string, unknown>[]): { endpointId: string; objectName: string }[] {
  return rows.map((r) => ({
    endpointId: String(r.endpointId ?? r.endpoint_id ?? ""),
    objectName: String(r.objectName ?? r.object_name ?? ""),
  }));
}
