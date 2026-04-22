import { lazy, Suspense, type ReactNode } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { adaptLiveWidgetShell } from "@/lib/dashboard/adapters/liveWidgetShellAdapter";
import { adaptSiteSummaryWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { TextWidget } from "./widgets/TextWidget";
import { KpiWidget } from "./widgets/KpiWidget";
import { DeviceTileWidget } from "./widgets/DeviceTileWidget";
import { HealthSummaryWidget } from "./widgets/HealthSummaryWidget";
import { AlertSummaryWidget } from "./widgets/AlertSummaryWidget";
import { OpsOverviewKpisWidget } from "./widgets/OpsOverviewKpisWidget";
import { OpsRecentAlertsWidget } from "./widgets/OpsRecentAlertsWidget";
import { OpsRecentActivityListWidget } from "./widgets/OpsRecentActivityListWidget";
import { OpsAlertTrendsWidget } from "./widgets/OpsAlertTrendsWidget";

const ChartWidgetLazy = lazy(() =>
  import("./widgets/ChartWidgetRenderer").then((m) => ({ default: m.ChartWidgetRenderer })),
);
const MapWidgetLazy = lazy(() => import("./widgets/MapWidget").then((m) => ({ default: m.MapWidget })));
const TableWidgetLazy = lazy(() =>
  import("./widgets/TableWidgetRenderer").then((m) => ({ default: m.TableWidgetRenderer })),
);

function WidgetFallback({ label, block }: { label: string; block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state="loading"
      widgetKind="loading"
      loadingMessage={label}
    />
  );
}

export function DashboardWidgetView({ block }: { block: DashboardLiveWidgetDTO }) {
  const shell = adaptLiveWidgetShell(block);
  if (shell.error) {
    const pres = resolveWidgetPresentation(block);
    return (
      <DashboardWidgetFrame
        block={block}
        presentation={pres}
        state="error"
        widgetKind="error"
        errorMessage={shell.error}
      />
    );
  }

  const { degraded, warning, sourceMissing } = shell;

  let body: ReactNode;
  switch (block.type) {
    case "text":
      body = <TextWidget block={block} />;
      break;
    case "ops_overview_kpis":
      body = <OpsOverviewKpisWidget block={block} />;
      break;
    case "ops_device_table":
      body = (
        <Suspense fallback={<WidgetFallback label="Loading table…" block={block} />}>
          <TableWidgetLazy block={block} />
        </Suspense>
      );
      break;
    case "ops_alert_trends":
      body = <OpsAlertTrendsWidget block={block} />;
      break;
    case "ops_recent_activity":
      body = <OpsRecentActivityListWidget block={block} />;
      break;
    case "ops_recent_alerts":
      body = <OpsRecentAlertsWidget block={block} />;
      break;
    case "kpi":
      body = <KpiWidget block={block} />;
      break;
    case "table":
      body = (
        <Suspense fallback={<WidgetFallback label="Loading table…" block={block} />}>
          <TableWidgetLazy block={block} />
        </Suspense>
      );
      break;
    case "chart":
      body = (
        <Suspense fallback={<WidgetFallback label="Loading chart…" block={block} />}>
          <ChartWidgetLazy block={block} />
        </Suspense>
      );
      break;
    case "device_tile":
      body = <DeviceTileWidget block={block} />;
      break;
    case "map":
    case "fleet_map":
      body = (
        <Suspense fallback={<WidgetFallback label="Loading map…" block={block} />}>
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
        <DashboardWidgetFrame
          block={block}
          presentation={resolveWidgetPresentation(block)}
          state="normal"
          widgetKind="generic"
          bodyFill
        >
          <pre className="dash-wf-generic__pre">{JSON.stringify(block.data, null, 2)}</pre>
        </DashboardWidgetFrame>
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
  const vm = adaptSiteSummaryWidget(block);
  const pres = resolveWidgetPresentation(block);
  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state="normal"
      widgetKind="site-summary"
      subtitle={<strong className="dash-wf-site__name">{vm.siteName}</strong>}
    >
      <div className="dash-wf-site__stats">
        <span className="dash-wf-site__stat">
          <span className="dash-wf-site__stat-label">Devices</span>
          <span className="dash-wf-site__stat-value">{String(vm.deviceCount)}</span>
        </span>
        <span className="dash-wf-site__stat">
          <span className="dash-wf-site__stat-label">Data objects</span>
          <span className="dash-wf-site__stat-value">{String(vm.dataObjectCount)}</span>
        </span>
      </div>
    </DashboardWidgetFrame>
  );
}
