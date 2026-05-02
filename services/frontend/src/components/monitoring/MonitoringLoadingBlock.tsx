import { Loader2 } from "lucide-react";

/** Shown while a monitoring tab fetches data (tab switch or initial load) — avoids empty-table flash. */
export function MonitoringLoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="monitoring-dm-loading" role="status" aria-live="polite" aria-busy="true">
      <Loader2 className="monitoring-dm-loading__spin" size={36} strokeWidth={2} aria-hidden />
      <span className="monitoring-dm-loading__label">{label}</span>
    </div>
  );
}
