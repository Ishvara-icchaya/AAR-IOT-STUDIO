import { lazy, Suspense, type ReactNode } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import { DEFAULT_MAP_STYLE_URL } from "@/lib/dashboardMapStyle";
import { TextWidget } from "./widgets/TextWidget";
import { KpiWidget } from "./widgets/KpiWidget";
import { TableWidget } from "./widgets/TableWidget";
import { DeviceTileWidget } from "./widgets/DeviceTileWidget";
import { HealthSummaryWidget } from "./widgets/HealthSummaryWidget";
import { AlertSummaryWidget } from "./widgets/AlertSummaryWidget";
import {
  DashboardLiveProvider,
  type DashboardLiveRuntimeValue,
} from "./DashboardLiveContext";

const ChartWidgetLazy = lazy(() =>
  import("./widgets/ChartWidget").then((m) => ({ default: m.ChartWidget })),
);
const MapWidgetLazy = lazy(() => import("./widgets/MapWidget").then((m) => ({ default: m.MapWidget })));

function WidgetFallback({ label }: { label: string }) {
  return (
    <div className="dash-widget dash-widget--loading">
      <p className="dash-widget__muted" style={{ margin: 0 }}>
        {label}
      </p>
    </div>
  );
}

function parseRows(
  layout: unknown,
): Array<{ rowId: string; columns: Array<{ columnId: string; span: number; widget?: DashboardWidgetModel }> }> {
  if (!layout || typeof layout !== "object") return [];
  const rowsRaw = (layout as Record<string, unknown>).rows;
  if (!Array.isArray(rowsRaw)) return [];
  return rowsRaw.map((r: unknown) => {
    if (!r || typeof r !== "object") return { rowId: "", columns: [] };
    const row = r as Record<string, unknown>;
    const rowId = String(row.rowId ?? row.row_id ?? "");
    const colsRaw = row.columns;
    const columns: Array<{ columnId: string; span: number; widget?: DashboardWidgetModel }> = [];
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
        columns.push({ columnId, span, widget });
      }
    }
    return { rowId, columns };
  });
}

function buildRuntimeFromDashboard(dashboard: unknown): DashboardLiveRuntimeValue {
  const o = dashboard && typeof dashboard === "object" ? (dashboard as Record<string, unknown>) : {};
  const settings =
    o.settings && typeof o.settings === "object" ? (o.settings as Record<string, unknown>) : {};
  const fromApi = typeof settings.map_style_url === "string" ? settings.map_style_url.trim() : "";
  const env = (import.meta.env.VITE_DASHBOARD_MAP_STYLE_URL as string | undefined)?.trim();
  const mapStyleUrl = fromApi || env || DEFAULT_MAP_STYLE_URL;
  return {
    mapStyleUrl,
    usesDefaultDemoTiles: settings.uses_default_demo_tiles === true,
  };
}

export function DashboardWidgetView({ block }: { block: DashboardLiveWidgetDTO }) {
  const d = (block.data ?? {}) as Record<string, unknown>;
  const err = typeof d.error === "string" ? d.error : null;
  if (err) {
    return (
      <div className="dash-widget dash-widget--error">
        <h3 className="dash-widget__title">{block.title}</h3>
        <p style={{ color: "#f66", margin: 0 }}>{err}</p>
      </div>
    );
  }

  const degraded = d.degraded === true;
  const warning = typeof d.warning === "string" ? d.warning : "";
  const sourceMissing = d.source_missing === true;

  let body: ReactNode;
  switch (block.type) {
    case "text":
      body = <TextWidget block={block} />;
      break;
    case "kpi":
      body = <KpiWidget block={block} />;
      break;
    case "table":
      body = <TableWidget block={block} />;
      break;
    case "chart":
      body = (
        <Suspense fallback={<WidgetFallback label="Loading chart…" />}>
          <ChartWidgetLazy block={block} />
        </Suspense>
      );
      break;
    case "device_tile":
      body = <DeviceTileWidget block={block} />;
      break;
    case "map":
      body = (
        <Suspense fallback={<WidgetFallback label="Loading map…" />}>
          <MapWidgetLazy block={block} />
        </Suspense>
      );
      break;
    case "health_summary":
      body = <HealthSummaryWidget block={block} />;
      break;
    case "alert_summary":
      body = <AlertSummaryWidget block={block} />;
      break;
    case "site_summary":
      body = <SiteSummaryFallback block={block} />;
      break;
    default:
      body = (
        <div className="dash-widget dash-widget--generic">
          <h3 className="dash-widget__title">{block.title}</h3>
          <pre style={{ fontSize: "0.75rem", overflow: "auto", maxHeight: 200 }}>
            {JSON.stringify(block.data, null, 2)}
          </pre>
        </div>
      );
  }

  return (
    <div className="dash-widget-stack">
      {degraded && warning ? (
        <div className="dash-widget-degraded" role="status">
          <strong>Degraded</strong>: {warning}
          {sourceMissing ? " · Binding is kept — restore or change the source in the builder." : ""}
        </div>
      ) : null}
      {body}
    </div>
  );
}

function SiteSummaryFallback({ block }: { block: DashboardLiveWidgetDTO }) {
  const d = block.data ?? {};
  return (
    <div className="dash-widget">
      <h3 className="dash-widget__title">{block.title}</h3>
      <p>
        <strong>{String(d.site_name ?? "—")}</strong>
      </p>
      <p className="dash-widget__muted">
        Devices: {String(d.device_count ?? 0)} · Data objects: {String(d.data_object_count ?? 0)}
      </p>
    </div>
  );
}

export function DashboardLiveRenderer({
  layout,
  widgets,
  renderedAt,
  dashboard,
  enterpriseMode,
}: {
  layout: unknown;
  widgets: DashboardLiveWidgetDTO[];
  renderedAt?: string;
  /** Full `dashboard` object from live/preview API (for map style + settings). */
  dashboard?: unknown;
  /** Enterprise landing: enables map side panel (object counts by site). */
  enterpriseMode?: boolean;
}) {
  const byId = Object.fromEntries(widgets.map((w) => [w.widget_id, w])) as Record<string, DashboardLiveWidgetDTO>;
  const rows = parseRows(layout);
  const runtime: DashboardLiveRuntimeValue = {
    ...buildRuntimeFromDashboard(dashboard),
    enterpriseMode: enterpriseMode === true,
  };

  if (rows.length === 0) {
    return (
      <DashboardLiveProvider value={runtime}>
        <div className="dash-widget__empty">
          <p className="dash-widget__muted">No rows in this dashboard layout.</p>
        </div>
      </DashboardLiveProvider>
    );
  }

  return (
    <DashboardLiveProvider value={runtime}>
      <div className="dash-live">
        {renderedAt && (
          <p className="dash-live__meta dash-widget__muted" style={{ marginBottom: "0.75rem" }}>
            Rendered {renderedAt}
          </p>
        )}
        {rows.map((row, ri) => (
          <div key={row.rowId || `row-${ri}`} className="dash-row">
            {row.columns.map((col) => (
              <div
                key={col.columnId}
                className="dash-col"
                style={{ gridColumn: `span ${Math.min(12, Math.max(1, col.span))}` }}
              >
                {col.widget ? (
                  (() => {
                    const b = byId[col.widget.widgetId];
                    if (!b) {
                      return (
                        <div className="dash-widget dash-widget--empty">
                          <p className="dash-widget__muted">
                            No resolved data for this widget slot (layout may be out of sync).
                          </p>
                        </div>
                      );
                    }
                    return <DashboardWidgetView block={b} />;
                  })()
                ) : (
                  <div className="dash-slot dash-slot--empty" />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </DashboardLiveProvider>
  );
}
