import { useMemo, useState } from "react";
import type { DashboardDefinition2, DashboardWidgetInstance2 } from "@/types/dashboard2";
import { DashboardDesignerGrid } from "./DashboardDesignerGrid";
import { DashboardRuntimeGrid } from "./DashboardRuntimeGrid";
import { DashboardWidgetConfigPanel } from "./DashboardWidgetConfigPanel";

export function DashboardDesignerShell({
  dashboard,
  onChange,
}: {
  dashboard: DashboardDefinition2;
  onChange: (next: DashboardDefinition2) => void;
}) {
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(dashboard.widgets[0]?.id ?? null);
  const selectedWidget = useMemo(
    () => dashboard.widgets.find((w) => w.id === selectedWidgetId) ?? null,
    [dashboard.widgets, selectedWidgetId],
  );

  function updateWidget(nextWidget: DashboardWidgetInstance2) {
    onChange({ ...dashboard, widgets: dashboard.widgets.map((w) => (w.id === nextWidget.id ? nextWidget : w)) });
  }

  return (
    <div className="dashboard2-designer-shell">
      <section className="dashboard2-designer-shell__canvas">
        <DashboardDesignerGrid
          dashboard={dashboard}
          onLayoutsChange={(layouts) => onChange({ ...dashboard, layouts: layouts as DashboardDefinition2["layouts"] })}
        />
        <div className="dashboard2-widget-select-row">
          {dashboard.widgets.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`dashboard2-widget-chip ${selectedWidgetId === w.id ? "is-active" : ""}`}
              onClick={() => setSelectedWidgetId(w.id)}
            >
              {w.title}
            </button>
          ))}
        </div>
      </section>
      <section className="dashboard2-designer-shell__preview">
        <h3>Preview</h3>
        <DashboardRuntimeGrid dashboard={dashboard} mode="preview" />
      </section>
      <DashboardWidgetConfigPanel selectedWidget={selectedWidget} onChangeWidget={updateWidget} />
    </div>
  );
}
