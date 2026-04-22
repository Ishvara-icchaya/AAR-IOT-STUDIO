import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import { getWidgetSizing } from "@/lib/dashboard/widgetSizing";

/** Compact tiles vs data-heavy widgets (maps, charts, tables). */
export type DashboardSlotKind = "compact" | "data";

export function slotKindForWidgetType(widgetType: string): DashboardSlotKind {
  const t = widgetType.trim().toLowerCase();
  if (
    t === "kpi" ||
    t === "device_tile" ||
    t === "health_summary" ||
    t === "alert_summary" ||
    t === "text" ||
    t === "site_summary" ||
    t === "ops_overview_kpis" ||
    t === "ops_recent_alerts" ||
    t === "ops_recent_activity"
  ) {
    return "compact";
  }
  return "data";
}

export type ParsedLayoutColumn = {
  columnId: string;
  span: number;
  widget?: DashboardWidgetModel;
  slotKind: DashboardSlotKind;
  slotMinHeightPx: number;
};

export type ParsedLayoutRow = {
  rowId: string;
  heightWeight: number;
  columns: ParsedLayoutColumn[];
};

/**
 * Parses dashboard layout JSON into weighted rows and 12-column spans.
 * Used by the live dashboard responsive grid.
 */
export function parseDashboardLayout(layout: unknown): ParsedLayoutRow[] {
  if (!layout || typeof layout !== "object") return [];
  const rowsRaw = (layout as Record<string, unknown>).rows;
  if (!Array.isArray(rowsRaw)) return [];
  return rowsRaw.map((r: unknown) => {
    if (!r || typeof r !== "object") return { rowId: "", heightWeight: 1, columns: [] };
    const row = r as Record<string, unknown>;
    const rowId = String(row.rowId ?? row.row_id ?? "");
    const hwRaw = row.heightWeight ?? row.height_weight;
    let heightWeight = 1;
    if (typeof hwRaw === "number" && Number.isFinite(hwRaw) && hwRaw > 0) {
      heightWeight = Math.min(40, Math.max(0.25, hwRaw));
    }
    const colsRaw = row.columns;
    const columns: ParsedLayoutColumn[] = [];
    if (Array.isArray(colsRaw)) {
      for (const c of colsRaw) {
        if (!c || typeof c !== "object") continue;
        const col = c as Record<string, unknown>;
        const columnId = String(col.columnId ?? col.column_id ?? "");
        const span = typeof col.span === "number" ? col.span : 12;
        let widget: DashboardWidgetModel | undefined;
        const w = col.widget;
        if (w && typeof w === "object") {
          const o = w as Record<string, unknown>;
          widget = {
            widgetId: String(o.widgetId ?? o.widget_id ?? ""),
            type: String(o.type ?? ""),
            title: String(o.title ?? ""),
            binding: (o.binding as DashboardWidgetModel["binding"]) || {},
            config: (o.config as Record<string, unknown>) || {},
          };
        }
        const wt = widget?.type?.trim() ? String(widget.type) : "";
        const sizing = getWidgetSizing(wt || "text");
        const slotKind = wt ? slotKindForWidgetType(wt) : "data";
        columns.push({
          columnId,
          span,
          widget,
          slotKind,
          slotMinHeightPx: sizing.minHeightPx,
        });
      }
    }
    return { rowId, heightWeight, columns };
  });
}

/**
 * When the dashboard shell is shorter than ~one comfortable laptop height, nudge flex row weights:
 * rows that contain data widgets (map/chart/table) get slightly more vertical share;
 * compact-only rows take slightly less — reduces wasted flex on short viewports.
 */
export function tuneRowWeightsForViewport(rows: ParsedLayoutRow[], viewportHeight: number): ParsedLayoutRow[] {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return rows;
  if (viewportHeight >= 820) return rows;

  return rows.map((row) => {
    const hasData = row.columns.some((c) => c.slotKind === "data");
    const onlyCompact =
      row.columns.length > 0 &&
      row.columns.every((c) => !c.widget || c.slotKind === "compact");
    let mult = 1;
    if (hasData) mult = 1.1;
    else if (onlyCompact) mult = 0.9;
    const nw = row.heightWeight * mult;
    return { ...row, heightWeight: Math.min(40, Math.max(0.25, nw)) };
  });
}
