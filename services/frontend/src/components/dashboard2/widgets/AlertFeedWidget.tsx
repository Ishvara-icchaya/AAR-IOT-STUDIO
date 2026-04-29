import type { ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function AlertFeedWidget({
  data,
}: {
  widget: DashboardWidgetInstance2;
  data: ResolvedDeviceCollectionRuntimeResponse | null;
  mode: "designer" | "preview" | "live";
}) {
  const rows = (data?.items ?? []).filter((r) => ["critical", "warning"].includes(String(r.health_status ?? "").toLowerCase()));
  if (!rows.length) return <p className="dashboard-widget-placeholder">No warning/critical alerts in current cohort.</p>;
  return (
    <ul className="dashboard2-alert-list">
      {rows.slice(0, 10).map((r) => (
        <li key={r.latest_device_state_id}>
          <strong>{r.health_status ?? "unknown"}</strong> - {r.device_label ?? r.resolved_device_id}
        </li>
      ))}
    </ul>
  );
}
