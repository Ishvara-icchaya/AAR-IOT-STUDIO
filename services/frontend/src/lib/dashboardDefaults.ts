import type { DashboardWidgetModel } from "@/types/dashboardLayout";

export const PALETTE_WIDGET_TYPES = [
  "table",
  "chart",
  "kpi",
  "device_tile",
  "map",
  "health_summary",
  "alert_summary",
  "site_summary",
  "text",
] as const;

export type PaletteWidgetType = (typeof PALETTE_WIDGET_TYPES)[number];

function titleCase(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function createDefaultWidget(type: string): DashboardWidgetModel {
  const widgetId = crypto.randomUUID();
  const title = titleCase(type);
  const base: DashboardWidgetModel = {
    widgetId,
    type,
    title,
    binding: {},
    config: {},
  };
  switch (type) {
    case "map":
      return {
        ...base,
        title: "Site map",
        binding: {
          latitudeField: "gps.lat",
          longitudeField: "gps.lon",
          kpiFields: [] as string[],
        },
        config: { autoIncludeGpsObjects: true, excludedSourceIds: [] as string[] },
      };
    case "text":
      return { ...base, config: { body: "Text" }, binding: {} };
    case "kpi":
      return {
        ...base,
        binding: { sourceType: "data_object", sourceId: "", metric: "value" },
      };
    case "table":
      return {
        ...base,
        binding: { sourceType: "data_object", sourceId: "", fields: [] as string[] },
      };
    case "chart":
      return {
        ...base,
        binding: {
          sourceType: "data_object",
          sourceId: "",
          chartType: "line",
          chartTimeWindow: "24h",
          xField: "t",
          yField: "",
        },
      };
    case "device_tile":
      return {
        ...base,
        binding: {
          sourceType: "data_object",
          sourceId: "",
          kpiFields: [] as string[],
        },
      };
    case "health_summary":
    case "alert_summary":
    case "site_summary":
      return { ...base, binding: {}, config: {} };
    default:
      return base;
  }
}

/** Preset column spans (12-column grid). */
export const ROW_PRESETS = {
  "1": [12],
  "2": [6, 6],
  "3": [4, 4, 4],
  "4": [3, 3, 3, 3],
} as const;

export type RowPresetKey = keyof typeof ROW_PRESETS;
