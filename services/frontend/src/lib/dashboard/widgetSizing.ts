import type { ResolvedWidgetPresentation } from "@/lib/widgetPresentation";

/** Layout hints for the responsive engine (CSS + flex mostly realize this). */
export type WidgetSizingContract = {
  minWidthPx: number;
  minHeightPx: number;
  preferredWidthPx: number;
  preferredHeightPx: number;
  compactMaxHeightPx?: number;
};

const BASE: Record<string, WidgetSizingContract> = {
  kpi: {
    minWidthPx: 120,
    minHeightPx: 72,
    preferredWidthPx: 200,
    preferredHeightPx: 120,
    compactMaxHeightPx: 140,
  },
  device_tile: {
    minWidthPx: 160,
    minHeightPx: 100,
    preferredWidthPx: 260,
    preferredHeightPx: 180,
    compactMaxHeightPx: 220,
  },
  health_summary: {
    minWidthPx: 200,
    minHeightPx: 64,
    preferredWidthPx: 360,
    preferredHeightPx: 100,
  },
  alert_summary: {
    minWidthPx: 220,
    minHeightPx: 120,
    preferredWidthPx: 400,
    preferredHeightPx: 220,
  },
  chart: {
    minWidthPx: 200,
    minHeightPx: 140,
    preferredWidthPx: 400,
    preferredHeightPx: 260,
  },
  table: {
    minWidthPx: 240,
    minHeightPx: 160,
    preferredWidthPx: 480,
    preferredHeightPx: 320,
  },
  map: {
    minWidthPx: 200,
    minHeightPx: 180,
    preferredWidthPx: 520,
    preferredHeightPx: 360,
  },
  fleet_map: {
    minWidthPx: 200,
    minHeightPx: 180,
    preferredWidthPx: 520,
    preferredHeightPx: 360,
  },
  text: {
    minWidthPx: 120,
    minHeightPx: 60,
    preferredWidthPx: 280,
    preferredHeightPx: 120,
  },
  site_summary: {
    minWidthPx: 200,
    minHeightPx: 80,
    preferredWidthPx: 360,
    preferredHeightPx: 120,
  },
  ops_overview_kpis: {
    minWidthPx: 200,
    minHeightPx: 72,
    preferredWidthPx: 480,
    preferredHeightPx: 120,
    compactMaxHeightPx: 160,
  },
  ops_recent_alerts: {
    minWidthPx: 200,
    minHeightPx: 100,
    preferredWidthPx: 400,
    preferredHeightPx: 220,
  },
  ops_recent_activity: {
    minWidthPx: 200,
    minHeightPx: 100,
    preferredWidthPx: 400,
    preferredHeightPx: 220,
  },
  ops_device_table: {
    minWidthPx: 240,
    minHeightPx: 160,
    preferredWidthPx: 480,
    preferredHeightPx: 280,
  },
  ops_alert_trends: {
    minWidthPx: 280,
    minHeightPx: 140,
    preferredWidthPx: 720,
    preferredHeightPx: 200,
  },
};

export function getWidgetSizing(widgetType: string): WidgetSizingContract {
  return BASE[widgetType] ?? {
    minWidthPx: 160,
    minHeightPx: 100,
    preferredWidthPx: 320,
    preferredHeightPx: 200,
  };
}

/** Whether a KPI/tile should cap vertical growth in large grid cells. */
export function shouldCapVerticalTile(
  widgetType: string,
  presentation: ResolvedWidgetPresentation,
): boolean {
  if (widgetType === "kpi" || widgetType === "device_tile" || widgetType === "health_summary") {
    return presentation.variant === "compact" || presentation.variant === "standard";
  }
  return false;
}
