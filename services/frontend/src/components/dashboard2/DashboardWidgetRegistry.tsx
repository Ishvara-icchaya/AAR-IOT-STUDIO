import type { ComponentType } from "react";
import type { DashboardWidgetInstance2, DashboardWidgetType2 } from "@/types/dashboard2";
import { LocationHeadingMapWidget } from "./widgets/LocationHeadingMapWidget";

type RuntimeProps = {
  widget: DashboardWidgetInstance2;
  data: unknown;
  mode: "designer" | "preview" | "live";
};

function PlaceholderWidget({ widget, mode }: RuntimeProps) {
  return (
    <div className="dashboard-widget-placeholder">
      <strong>{widget.type}</strong>
      <span>mode: {mode}</span>
    </div>
  );
}

export type DashboardWidgetRegistryEntry = {
  label: string;
  component: ComponentType<RuntimeProps>;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
};

export const DASHBOARD_WIDGET_REGISTRY_2: Record<DashboardWidgetType2, DashboardWidgetRegistryEntry> = {
  kpi: { label: "KPI Tile", component: PlaceholderWidget, defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 } },
  location_heading_map: {
    label: "Location / Heading Map",
    component: LocationHeadingMapWidget,
    defaultSize: { w: 8, h: 7 },
    minSize: { w: 5, h: 5 },
  },
  time_series_chart: {
    label: "Time-Series Chart",
    component: PlaceholderWidget,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },
  data_table: {
    label: "Data Table",
    component: PlaceholderWidget,
    defaultSize: { w: 8, h: 5 },
    minSize: { w: 5, h: 4 },
  },
  health_summary: {
    label: "Health Summary",
    component: PlaceholderWidget,
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
  },
  alert_feed: {
    label: "Alert Feed",
    component: PlaceholderWidget,
    defaultSize: { w: 4, h: 5 },
    minSize: { w: 3, h: 4 },
  },
  trend_panel: {
    label: "Trend Panel",
    component: PlaceholderWidget,
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
  },
  text: { label: "Text", component: PlaceholderWidget, defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 2 } },
};
