import type {
  DashboardDefinition2,
  DashboardLayoutItem2,
  DashboardLayouts2,
  DashboardWidgetInstance2,
  DashboardWidgetType2,
} from "@/types/dashboard2";

type LegacyWidget = {
  widgetId?: string;
  type?: string;
  title?: string;
  binding?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

type LegacyColumn = {
  span?: number;
  widget?: LegacyWidget;
};

type LegacyRow = {
  columns?: LegacyColumn[];
};

type LegacyDashboardLike = {
  id?: string;
  name?: string;
  description?: string | null;
  customer_id?: string;
  site_id?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
  layout?: { rows?: LegacyRow[] };
};

function normalizeWidgetType(raw: string | undefined): DashboardWidgetType2 {
  const t = String(raw ?? "text").trim().toLowerCase();
  if (
    t === "kpi" ||
    t === "location_heading_map" ||
    t === "time_series_chart" ||
    t === "data_table" ||
    t === "health_summary" ||
    t === "alert_feed" ||
    t === "trend_panel" ||
    t === "text"
  ) {
    return t;
  }
  if (t === "map" || t === "fleet_map") return "location_heading_map";
  if (t === "chart" || t === "ops_alert_trends") return "time_series_chart";
  if (t === "table" || t === "ops_device_table") return "data_table";
  if (t === "alert_summary" || t === "ops_recent_alerts") return "alert_feed";
  return "text";
}

export function migrateLegacyDashboardToGrid(d: LegacyDashboardLike): DashboardDefinition2 {
  const rows = Array.isArray(d.layout?.rows) ? d.layout?.rows ?? [] : [];
  const layoutLg: DashboardLayoutItem2[] = [];
  const widgets: DashboardWidgetInstance2[] = [];

  let cursorY = 0;
  rows.forEach((row, rowIndex) => {
    let cursorX = 0;
    const cols = Array.isArray(row.columns) ? row.columns : [];
    cols.forEach((col, colIndex) => {
      const w = Math.min(12, Math.max(1, Number(col.span ?? 12)));
      const legacyWidget = col.widget ?? {};
      const id = String(legacyWidget.widgetId ?? `v2-w-${rowIndex}-${colIndex}`);
      const widgetType = normalizeWidgetType(legacyWidget.type);
      const h = widgetType === "location_heading_map" ? 7 : widgetType === "time_series_chart" ? 5 : 4;
      layoutLg.push({ i: id, x: cursorX, y: cursorY, w, h, minW: 2, minH: 2 });
      widgets.push({
        id,
        type: widgetType,
        title: String(legacyWidget.title ?? "Widget"),
        binding: {
          sourceType: "resolved_device_collection",
          siteId: String(d.site_id ?? ""),
          endpointId: "",
          objectName: "",
        },
        config: { ...(legacyWidget.config ?? {}), ...(legacyWidget.binding ? { legacyBinding: legacyWidget.binding } : {}) },
        createdAt: String(d.created_at ?? new Date().toISOString()),
        updatedAt: String(d.updated_at ?? new Date().toISOString()),
      });
      cursorX += w;
    });
    cursorY += 7;
  });

  const layouts: DashboardLayouts2 = {
    lg: layoutLg,
    md: layoutLg.map((it) => ({ ...it, w: Math.min(it.w, 8), x: Math.min(it.x, 8) })),
    sm: layoutLg.map((it) => ({ ...it, w: Math.min(it.w, 4), x: Math.min(it.x, 4) })),
  };

  return {
    id: String(d.id ?? "legacy"),
    name: String(d.name ?? "Untitled dashboard"),
    description: d.description ?? undefined,
    customerId: String(d.customer_id ?? ""),
    siteId: d.site_id ?? undefined,
    version: 2,
    status: (d.status as DashboardDefinition2["status"]) || "draft",
    layouts,
    widgets,
    createdAt: String(d.created_at ?? new Date().toISOString()),
    updatedAt: String(d.updated_at ?? new Date().toISOString()),
  };
}
