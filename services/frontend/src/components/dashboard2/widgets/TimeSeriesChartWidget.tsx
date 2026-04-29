import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function TimeSeriesChartWidget({
  data,
}: {
  widget: DashboardWidgetInstance2;
  data: ResolvedDeviceCollectionRuntimeResponse | null;
  mode: "designer" | "preview" | "live";
}) {
  const trend = (((data?.trends ?? {}) as Record<string, unknown>).health_score ?? []) as Array<Record<string, unknown>>;
  const rows = trend.map((r) => ({ ts: String(r.ts ?? ""), value: Number(r.value ?? 0) }));
  if (!rows.length) return <p className="dashboard-widget-placeholder">No trend points yet.</p>;
  return (
    <div className="dashboard2-chart">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows}>
          <XAxis dataKey="ts" hide />
          <YAxis />
          <Tooltip />
          <Line dataKey="value" type="monotone" stroke="#60a5fa" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
