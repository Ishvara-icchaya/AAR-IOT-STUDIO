import type { ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function TrendPanelWidget({
  data,
}: {
  widget: DashboardWidgetInstance2;
  data: ResolvedDeviceCollectionRuntimeResponse | null;
  mode: "designer" | "preview" | "live";
}) {
  const trend = (((data?.trends ?? {}) as Record<string, unknown>).online_count ?? []) as Array<Record<string, unknown>>;
  if (!trend.length) return <p className="dashboard-widget-placeholder">No trend data.</p>;
  return (
    <div className="dashboard2-trend-list">
      {trend.slice(-8).map((p, i) => (
        <div key={`${p.ts ?? i}`} className="dashboard2-trend-list__row">
          <span>{String(p.ts ?? "").slice(0, 19)}</span>
          <strong>{Number(p.value ?? 0)}</strong>
        </div>
      ))}
    </div>
  );
}
