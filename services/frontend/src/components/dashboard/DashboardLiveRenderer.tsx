import { lazy, Suspense } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DEFAULT_MAP_STYLE_URL } from "@/lib/dashboardMapStyle";
import { parseDashboardLayout } from "@/lib/dashboard/dashboardLayoutEngine";
import {
  DashboardLiveProvider,
  type DashboardLiveRuntimeValue,
} from "./DashboardLiveContext";
import { DashboardRuntimeShell } from "./runtime/DashboardRuntimeShell";

/** Split grid + widget stack from live shell so map/chart/table lazy chunks load with the grid, not the shell. */
const DashboardResponsiveGridLazy = lazy(() =>
  import("./runtime/DashboardResponsiveGrid").then((m) => ({ default: m.DashboardResponsiveGrid })),
);

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

export function DashboardLiveRenderer({
  layout,
  widgets,
  renderedAt,
  dashboard,
  enterpriseMode,
  /** When true (default), rows use height weights and flex to fill one viewport (live / preview). */
  fitPage = true,
  /** Reference / default ops dashboard: compact vertical flow, no flex fill, no raw rendered meta. */
  layoutDensity = "default",
}: {
  layout: unknown;
  widgets: DashboardLiveWidgetDTO[];
  renderedAt?: string;
  /** Full `dashboard` object from live/preview API (for map style + settings). */
  dashboard?: unknown;
  /** Enterprise landing: enables map side panel (object counts by site). */
  enterpriseMode?: boolean;
  fitPage?: boolean;
  layoutDensity?: "default" | "reference" | "preview";
}) {
  const list = Array.isArray(widgets) ? widgets : [];
  const byId = Object.fromEntries(list.map((w) => [w.widget_id, w])) as Record<string, DashboardLiveWidgetDTO>;
  const rows = parseDashboardLayout(layout);
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

  const rootClass = [
    "dash-live",
    fitPage && layoutDensity !== "reference" && layoutDensity !== "preview" ? "dash-live--fit-page" : "",
    layoutDensity === "reference" ? "dash-live--reference" : "",
    layoutDensity === "preview" ? "dash-live--preview" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <DashboardLiveProvider value={runtime}>
      <DashboardRuntimeShell fitPage={fitPage && layoutDensity !== "reference" && layoutDensity !== "preview"}>
        <div className={rootClass}>
          <Suspense
            fallback={
              <div className="dash-widget__muted" style={{ padding: "1rem" }}>
                Loading dashboard layout…
              </div>
            }
          >
            <DashboardResponsiveGridLazy
              rows={rows}
              widgetsById={byId}
              fitPage={fitPage && layoutDensity !== "reference" && layoutDensity !== "preview"}
              renderedAt={renderedAt}
              hideRenderedMeta={layoutDensity === "reference"}
            />
          </Suspense>
        </div>
      </DashboardRuntimeShell>
    </DashboardLiveProvider>
  );
}
