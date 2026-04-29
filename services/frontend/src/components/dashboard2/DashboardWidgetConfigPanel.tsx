import type { DashboardWidgetInstance2 } from "@/types/dashboard2";
import { DashboardWidgetBindingPicker } from "./DashboardWidgetBindingPicker";

export function DashboardWidgetConfigPanel({
  selectedWidget,
  onChangeWidget,
}: {
  selectedWidget: DashboardWidgetInstance2 | null;
  onChangeWidget: (next: DashboardWidgetInstance2) => void;
}) {
  if (!selectedWidget) return <aside className="dashboard2-config-panel">Select a widget to configure.</aside>;
  return (
    <aside className="dashboard2-config-panel">
      <h3>Widget config</h3>
      <label>
        Title
        <input value={selectedWidget.title} onChange={(e) => onChangeWidget({ ...selectedWidget, title: e.target.value })} />
      </label>
      <label>
        Description
        <input
          value={selectedWidget.description ?? ""}
          onChange={(e) => onChangeWidget({ ...selectedWidget, description: e.target.value })}
        />
      </label>
      <label>
        Refresh interval (sec)
        <input
          type="number"
          min={5}
          max={3600}
          value={selectedWidget.refreshIntervalSec ?? 15}
          onChange={(e) =>
            onChangeWidget({ ...selectedWidget, refreshIntervalSec: Math.max(5, Math.min(3600, Number(e.target.value || 15))) })
          }
        />
      </label>
      <DashboardWidgetBindingPicker widget={selectedWidget} onChange={onChangeWidget} />
    </aside>
  );
}
