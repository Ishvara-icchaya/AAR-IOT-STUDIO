/** Resolved API `dashboard.settings` (snake_case from backend). */
export function getDashboardSettings(dashboard: unknown): Record<string, unknown> {
  if (!dashboard || typeof dashboard !== "object") return {};
  const s = (dashboard as Record<string, unknown>).settings;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}

export function parseLiveRefreshIntervalSec(dashboard: unknown): number {
  const s = getDashboardSettings(dashboard);
  const r = s.refresh_interval_sec;
  const n = typeof r === "number" ? r : Number(r);
  if (Number.isFinite(n) && n >= 5) return Math.min(3600, n);
  return 30;
}
