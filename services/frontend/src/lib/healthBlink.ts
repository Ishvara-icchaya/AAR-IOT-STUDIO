/** Server-derived blink_mode → CSS class (spec §17). */
export function blinkModeClass(mode: unknown): string {
  const m = typeof mode === "string" ? mode.toLowerCase() : "";
  if (m === "slow") return "blink-slow";
  if (m === "fast") return "blink-fast";
  return "blink-none";
}

export function healthColorVar(status: unknown): string {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (s === "red") return "var(--health-red, #ef4444)";
  if (s === "yellow") return "var(--health-yellow, #eab308)";
  if (s === "green") return "var(--health-green, #22c55e)";
  if (s === "offline") return "var(--health-offline, #64748b)";
  return "var(--color-text-muted)";
}
