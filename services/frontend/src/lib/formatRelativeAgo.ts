/** Human-readable "time ago" for dashboard refresh lines and list rows. */
export function formatRelativeAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 45) return "just now";
  if (sec < 3600) {
    const m = Math.max(1, Math.floor(sec / 60));
    return `${m} min ago`;
  }
  if (sec < 86400) {
    const h = Math.max(1, Math.floor(sec / 3600));
    return `${h} h ago`;
  }
  const d = Math.floor(sec / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
