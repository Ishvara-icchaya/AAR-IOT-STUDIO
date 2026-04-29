import type { ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function KpiTileWidget({
  widget,
  data,
}: {
  widget: DashboardWidgetInstance2;
  data: unknown;
  mode: "designer" | "preview" | "live";
}) {
  const collection = data as ResolvedDeviceCollectionRuntimeResponse | null;
  const metric = String((widget.config.metric as string | undefined) ?? "total");
  const summary = (collection?.summary ?? {}) as Record<string, unknown>;
  const value = summary[metric] ?? summary.total ?? 0;
  return (
    <div className="dashboard2-kpi">
      <div className="dashboard2-kpi__value">{String(value)}</div>
      <div className="dashboard2-kpi__meta">metric: {metric}</div>
    </div>
  );
}
