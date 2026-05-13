/** Labels and status-pill variants for API `footprint_operational_status` (operational lineage, not lifecycle). */

import { formatStatusDisplayLabel } from "@/lib/statusDisplay";

export type FootprintOperationalPillVariant = "online" | "degraded" | "offline" | "error" | "muted" | "disabled" | "waiting";

export function formatFootprintOperationalStatus(raw: string | null | undefined): string {
  const s = raw?.trim();
  if (!s) return "—";
  return formatStatusDisplayLabel(s);
}

export function footprintOperationalPillVariant(raw: string | null | undefined): FootprintOperationalPillVariant {
  const s = raw?.trim();
  if (!s) return "muted";
  if (s === "ready") return "online";
  if (s === "broken") return "offline";
  /* stale | incomplete | unknown — neutral tier */
  return "muted";
}
