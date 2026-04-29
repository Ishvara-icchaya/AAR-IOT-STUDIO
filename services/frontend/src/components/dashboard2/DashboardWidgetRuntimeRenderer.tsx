import { DASHBOARD_WIDGET_REGISTRY_2 } from "./DashboardWidgetRegistry";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function DashboardWidgetRuntimeRenderer2({
  widget,
  data,
  mode,
}: {
  widget: DashboardWidgetInstance2;
  data: unknown;
  mode: "designer" | "preview" | "live";
}) {
  const entry = DASHBOARD_WIDGET_REGISTRY_2[widget.type];
  const Component = entry?.component;
  if (!Component) {
    return <div className="dashboard-widget-placeholder">Unknown widget type: {widget.type}</div>;
  }
  return <Component widget={widget} data={data} mode={mode} />;
}
