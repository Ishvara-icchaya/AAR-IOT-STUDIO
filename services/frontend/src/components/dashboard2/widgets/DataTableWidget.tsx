import type { ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function DataTableWidget({
  data,
}: {
  widget: DashboardWidgetInstance2;
  data: unknown;
  mode: "designer" | "preview" | "live";
}) {
  const collection = data as ResolvedDeviceCollectionRuntimeResponse | null;
  const rows = collection?.items ?? [];
  if (!rows.length) return <p className="dashboard-widget-placeholder">No rows.</p>;
  return (
    <div className="dashboard2-table-wrap">
      <table className="dashboard2-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Lifecycle</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row) => (
            <tr key={row.latest_device_state_id}>
              <td>{row.device_label ?? row.resolved_device_id}</td>
              <td>{row.lifecycle_status}</td>
              <td>{row.health_status ?? "unknown"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
