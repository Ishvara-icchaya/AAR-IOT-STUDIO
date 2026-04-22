import { useMemo, type ReactNode } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { useOpsShellOptional } from "@/contexts/OpsShellContext";
import { formatRelativeAgo } from "@/lib/formatRelativeAgo";
import {
  findWidget,
  type OpsActivityItem,
  type OpsAlertItem,
  type OpsDeviceRow,
  type OpsOverviewKpiData,
  type OpsTrendDay,
} from "./operationsOverviewModel";
import { parseCommandCenter, type CommandCenterPayload } from "./operationsOverviewCommandCenter";
import { OverviewKpiRow } from "./OverviewKpiRow";
import { OverviewTrendCard } from "./OverviewTrendCard";
import { OverviewListCard, type OverviewListRow } from "./OverviewListCard";
import { OverviewStatusTableCard } from "./OverviewStatusTableCard";
import { OverviewInsightStrip } from "./OverviewInsightStrip";
import { OverviewExecutiveBar } from "./OverviewExecutiveBar";
import { OverviewSystemCharts } from "./OverviewSystemCharts";
import { OverviewHealthInsights } from "./OverviewHealthInsights";

import "./operations-overview-default.css";

const EMPTY_CC: CommandCenterPayload = {
  summary_segments: [],
  kpi_cards: [],
  ingestion_series: [],
  latency_series: [],
  health_distribution: null,
  top_alert_devices: [],
  data_volume_24h: 0,
  system_uptime_pct: null,
};

type Props = {
  widgets: DashboardLiveWidgetDTO[];
  renderedAt: string;
  syncing: boolean;
  onRefresh: () => void;
  commandCenter?: Record<string, unknown> | null;
};

function alertSeverityTone(sev: string): "crit" | "warn" | "muted" {
  const s = sev.trim().toLowerCase();
  if (["critical", "error", "fatal"].includes(s)) return "crit";
  if (["warning", "warn"].includes(s)) return "warn";
  return "muted";
}

function eventIcon(et: string | undefined): string {
  const e = (et || "").toLowerCase();
  if (e.includes("workflow")) return "⚡";
  if (e.includes("data")) return "📥";
  return "●";
}

export function OperationsOverviewDefault({ widgets, renderedAt, syncing, onRefresh, commandCenter }: Props) {
  const ops = useOpsShellOptional();
  const cc = useMemo(
    () => parseCommandCenter(commandCenter ?? undefined) ?? EMPTY_CC,
    [commandCenter],
  );

  const kpiW = findWidget(widgets, "ops_overview_kpis");
  const trendW = findWidget(widgets, "ops_alert_trends");
  const alertsW = findWidget(widgets, "ops_recent_alerts");
  const activityW = findWidget(widgets, "ops_recent_activity");
  const devicesW = findWidget(widgets, "ops_device_table");

  const kpiData = (kpiW?.data ?? {}) as OpsOverviewKpiData;
  const trendSeries = useMemo(() => {
    const raw = (trendW?.data as { series?: OpsTrendDay[] } | undefined)?.series;
    return Array.isArray(raw) ? raw : [];
  }, [trendW?.data]);

  const alertRows: OverviewListRow[] = useMemo(() => {
    const items = Array.isArray((alertsW?.data as { items?: OpsAlertItem[] } | undefined)?.items)
      ? ((alertsW?.data as { items: OpsAlertItem[] }).items ?? [])
      : [];
    return items.map((row, i) => {
      const headline = (row.title && String(row.title).trim()) || "Alert";
      const parts: string[] = [];
      if (row.device_name) parts.push(String(row.device_name));
      if (row.site_name) parts.push(String(row.site_name));
      const meta = parts.length ? parts.join(" · ") : undefined;
      return {
        key: `${row.created_at ?? ""}-${headline}-${i}`,
        main: <span className="ops-list__text">{headline}</span>,
        meta,
        ts: formatRelativeAgo(row.created_at),
        sevTone: alertSeverityTone(String(row.severity ?? "")),
      };
    });
  }, [alertsW?.data]);

  const activityRows: OverviewListRow[] = useMemo(() => {
    const items = Array.isArray((activityW?.data as { items?: OpsActivityItem[] } | undefined)?.items)
      ? ((activityW?.data as { items: OpsActivityItem[] }).items ?? [])
      : [];
    return items.map((row, i) => {
      const line =
        (row.summary && String(row.summary).trim()) ||
        [row.object_name, row.event_type].filter(Boolean).join(" — ") ||
        "—";
      const icon = eventIcon(row.event_type);
      const main: ReactNode = (
        <span className="ops-list__title-wrap">
          <span className="ops-list__etype" aria-hidden>
            {icon}
          </span>
          <span className="ops-list__text">{line}</span>
        </span>
      );
      return {
        key: `${row.timestamp ?? ""}-${line}-${i}`,
        main,
        ts: formatRelativeAgo(row.timestamp),
      };
    });
  }, [activityW?.data]);

  const deviceRows = useMemo(() => {
    const d = devicesW?.data as { rows?: OpsDeviceRow[] } | undefined;
    return Array.isArray(d?.rows) ? d.rows : [];
  }, [devicesW?.data]);

  return (
    <div className="ops-overview">
      <div className="ops-overview-banner" role="region" aria-label="Operations command center">
        <p className="ops-overview-banner__msg">Operations Overview — system default command center</p>
        <div className="ops-overview-banner__row">
          <div className="ops-overview-banner__scope">
            {ops ? <OpsScopeControls variant="inline" timeRangeLabel="Time range" /> : null}
          </div>
          <div className="ops-overview-banner__right">
            <p className="ops-overview-muted">Last updated {formatRelativeAgo(renderedAt)}</p>
            <button
              type="button"
              className="ops-overview-refresh"
              aria-label="Refresh dashboard"
              disabled={syncing}
              onClick={() => onRefresh()}
              title="Refresh"
            >
              ↻
            </button>
          </div>
        </div>
      </div>

      <div className="ops-overview-stack">
        {cc.summary_segments.length ? <OverviewInsightStrip segments={cc.summary_segments} /> : null}
        <OverviewExecutiveBar cc={cc} />
        <div className="ops-overview-grid">
          <OverviewKpiRow data={kpiData} kpiCards={cc.kpi_cards} />
          <OverviewTrendCard
            title={trendW?.title?.trim() || "Alert trends"}
            series={trendSeries}
            dataRevision={renderedAt}
          />
          <OverviewSystemCharts cc={cc} dataRevision={renderedAt} />
          <OverviewHealthInsights cc={cc} dataRevision={renderedAt} />
          <div className="ops-overview-row-3">
            <OverviewListCard
              title={alertsW?.title?.trim() || "Recent alerts"}
              viewAllTo="/alerts"
              emptyText="No recent alerts"
              rows={alertRows}
            />
            <OverviewListCard
              title={activityW?.title?.trim() || "Recent activity"}
              viewAllTo="/administration/monitoring"
              viewAllLabel="Live stream"
              emptyText="No recent activity"
              rows={activityRows}
            />
            <OverviewStatusTableCard
              title={devicesW?.title?.trim() || "Device status"}
              viewAllTo="/devices/manage"
              rows={deviceRows}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
