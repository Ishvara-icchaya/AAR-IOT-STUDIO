/**
 * Hard boundary: normalize live widget payloads into typed view models.
 * Renderers consume VMs only — no ad-hoc Record parsing in components.
 */
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";

function dataObject(block: DashboardLiveWidgetDTO): Record<string, unknown> {
  return block.data && typeof block.data === "object" ? (block.data as Record<string, unknown>) : {};
}

export type KpiViewModel = {
  value: unknown;
  metric: string;
  deviceName: string;
  updatedAt: string | null;
  blinkMode: string | null;
  healthStatus: string | null;
};

export function adaptKpiWidget(block: DashboardLiveWidgetDTO): KpiViewModel {
  const d = dataObject(block);
  return {
    value: d.value,
    metric: typeof d.metric === "string" ? d.metric : "",
    deviceName: typeof d.device_name === "string" && d.device_name.trim() ? d.device_name.trim() : "",
    updatedAt: typeof d.updated_at === "string" ? d.updated_at : null,
    blinkMode: typeof d.blink_mode === "string" ? d.blink_mode : null,
    healthStatus: typeof d.health_status === "string" ? d.health_status : null,
  };
}

export type DeviceTileViewModel = {
  deviceName: string;
  displayName: string;
  deviceIcon: string | null;
  healthStatus: string;
  healthMessage: string | null;
  updatedAt: string | null;
  blinkMode: string | null;
  kpis: Record<string, unknown>;
  sourceId: string | null;
};

export function adaptDeviceTileWidget(block: DashboardLiveWidgetDTO): DeviceTileViewModel {
  const d = dataObject(block);
  const kpis = (d.kpis as Record<string, unknown>) || {};
  return {
    deviceName: String(d.device_name ?? d.display_name ?? block.title),
    displayName: String(d.display_name ?? ""),
    deviceIcon: d.device_icon ? String(d.device_icon) : null,
    healthStatus: String(d.health_status ?? "—"),
    healthMessage: d.health_message ? String(d.health_message) : null,
    updatedAt: typeof d.updated_at === "string" ? d.updated_at : null,
    blinkMode: typeof d.blink_mode === "string" ? d.blink_mode : null,
    kpis,
    sourceId: typeof d.source_id === "string" ? d.source_id : null,
  };
}

export type ChartViewModel = {
  seriesX: unknown[];
  seriesY: unknown[];
  chartType: string;
  chartTimeWindow: string;
  xField: string;
  yField: string;
  updatedAt: string | null;
};

export function adaptChartWidget(block: DashboardLiveWidgetDTO): ChartViewModel {
  const d = dataObject(block);
  const series = (d.series as { x?: unknown[]; y?: unknown[] }) || {};
  return {
    seriesX: Array.isArray(series.x) ? series.x : [],
    seriesY: Array.isArray(series.y) ? series.y : [],
    chartType: String(d.chart_type ?? "line").toLowerCase(),
    chartTimeWindow: String(d.chart_time_window ?? ""),
    xField: String(d.x_field ?? "t"),
    yField: String(d.y_field ?? "value"),
    updatedAt: typeof d.updated_at === "string" ? d.updated_at : null,
  };
}

export type TableViewModel = {
  rows: Record<string, unknown>[];
  fields: string[];
  rowIndicators: Record<string, unknown>[];
  updatedAt: string | null;
  displayName: string | null;
  sourceId: string | null;
  /** Optional per-field header labels from API (e.g. ops device table). */
  columnHeaders: Record<string, string>;
};

export function adaptTableWidget(block: DashboardLiveWidgetDTO): TableViewModel {
  const d = dataObject(block);
  const rows = Array.isArray(d.rows) ? (d.rows as Record<string, unknown>[]) : [];
  const fieldsRaw = d.fields;
  const fields =
    Array.isArray(fieldsRaw) && fieldsRaw.length
      ? fieldsRaw.map(String)
      : rows[0]
        ? Object.keys(rows[0]).filter((k) => !k.startsWith("_"))
        : [];
  const rowIndicators = Array.isArray(d.row_indicators) ? (d.row_indicators as Record<string, unknown>[]) : [];
  const headersRaw = d.column_headers ?? d.columnHeaders;
  const columnHeaders: Record<string, string> =
    headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)
      ? Object.fromEntries(
          Object.entries(headersRaw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
        )
      : {};
  return {
    rows,
    fields,
    rowIndicators,
    updatedAt: typeof d.updated_at === "string" ? d.updated_at : null,
    displayName: typeof d.display_name === "string" ? d.display_name : null,
    sourceId: typeof d.source_id === "string" ? d.source_id : null,
    columnHeaders,
  };
}

export type HealthSummaryViewModel = {
  counts: { green: number; yellow: number; red: number; offline: number };
  blinkMode: string | null;
};

export function adaptHealthSummaryWidget(block: DashboardLiveWidgetDTO): HealthSummaryViewModel {
  const d = dataObject(block);
  const c = d.counts as Record<string, unknown> | undefined;
  const z = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  return {
    counts: {
      green: z(c?.green),
      yellow: z(c?.yellow),
      red: z(c?.red),
      offline: z(c?.offline),
    },
    blinkMode: typeof d.blink_mode === "string" ? d.blink_mode : null,
  };
}

export type AlertSummaryViewModel = {
  activeBySeverity: Record<string, number>;
  recent: { title?: string; severity?: string; acknowledged?: boolean }[];
  unacknowledgedCount: number;
  blinkMode: string | null;
};

export function adaptAlertSummaryWidget(block: DashboardLiveWidgetDTO): AlertSummaryViewModel {
  const d = dataObject(block);
  const by = (d.active_by_severity as Record<string, number>) || {};
  const recent = Array.isArray(d.recent)
    ? (d.recent as { title?: string; severity?: string; acknowledged?: boolean }[])
    : [];
  return {
    activeBySeverity: by,
    recent,
    unacknowledgedCount: Number(d.unacknowledged_count ?? 0),
    blinkMode: typeof d.blink_mode === "string" ? d.blink_mode : null,
  };
}

export type SiteSummaryViewModel = {
  siteName: string;
  deviceCount: number;
  dataObjectCount: number;
};

export function adaptSiteSummaryWidget(block: DashboardLiveWidgetDTO): SiteSummaryViewModel {
  const d = dataObject(block);
  const z = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0);
  return {
    siteName: typeof d.site_name === "string" ? d.site_name : "—",
    deviceCount: z(d.device_count),
    dataObjectCount: z(d.data_object_count),
  };
}

export type TextWidgetViewModel = {
  body: string;
};

export function adaptTextWidget(block: DashboardLiveWidgetDTO): TextWidgetViewModel {
  const d = dataObject(block);
  const cfg = block.config && typeof block.config === "object" ? (block.config as Record<string, unknown>) : {};
  const fromData = typeof d.body === "string" ? d.body : "";
  const fromCfg = typeof cfg.body === "string" ? cfg.body : typeof cfg.text === "string" ? cfg.text : "";
  return { body: fromData || fromCfg };
}
