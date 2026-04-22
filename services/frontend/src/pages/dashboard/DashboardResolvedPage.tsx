import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as dashApi from "@/api/dashboard";
import type { DashboardLiveDTO } from "@/types/dashboard";
import { DashboardLiveRenderer } from "@/components/dashboard/DashboardLiveRenderer";
import { DashboardLiveToolbar } from "@/components/dashboard/DashboardLiveToolbar";
import { OperationsOverviewDefault } from "@/components/operations-overview";
import { useOpsShellOptional, type OpsTimeRange } from "@/contexts/OpsShellContext";
import { parseLiveRefreshIntervalSec } from "@/lib/dashboardLiveSettings";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import { setDefaultDashboardReferenceActive } from "@/stores/defaultDashboardShellStore";

import "@/pages/device-register-page.css";

type Props = { toolbarVariant?: "enterprise" | "landing" };

function opsTimeRangeToHours(tr: OpsTimeRange): number {
  switch (tr) {
    case "1h":
      return 1;
    case "24h":
      return 24;
    case "7d":
      return 24 * 7;
    case "30d":
      return 24 * 30;
    default:
      return 24;
  }
}

export function DashboardResolvedPage({ toolbarVariant = "landing" }: Props) {
  const [payload, setPayload] = useState<DashboardLiveDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const ops = useOpsShellOptional();

  const load = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading !== false;
      setErr(null);
      if (showLoading) setLoading(true);
      try {
        const q: dashApi.ResolvedDashboardQuery | undefined = ops
          ? { siteId: ops.siteId ?? undefined, hours: opsTimeRangeToHours(ops.timeRange) }
          : undefined;
        const data = await dashApi.getResolvedDashboard(q);
        setPayload(data);
      } catch (e) {
        setPayload(null);
        setErr(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [ops],
  );

  const refreshOpsOverview = useCallback(async () => {
    setSyncing(true);
    try {
      await load({ showLoading: false });
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const refreshSec = parseLiveRefreshIntervalSec(payload?.dashboard);

  useEffect(() => {
    void load({ showLoading: true });
  }, [load]);

  useEffect(() => {
    if (!ops || ops.refreshToken === 0) return;
    void load({ showLoading: false });
  }, [ops?.refreshToken, load, ops]);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => void load({ showLoading: false }), refreshSec * 1000);
    return () => window.clearInterval(t);
  }, [paused, load, refreshSec]);

  useEffect(() => {
    setDefaultDashboardReferenceActive(Boolean(payload?.is_default_dashboard));
    return () => setDefaultDashboardReferenceActive(false);
  }, [payload?.is_default_dashboard]);

  const dash = payload?.dashboard as Record<string, unknown> | undefined;
  const isDefault = Boolean(payload?.is_default_dashboard);

  if (loading && !payload && !err) {
    return (
      <PageShell className="dash-live-page device-manage-page" variant="list">
        <PageStatus variant="info">Loading dashboard…</PageStatus>
      </PageShell>
    );
  }

  const rawLayout = dash?.layout;
  const layout =
    rawLayout != null && typeof rawLayout === "object" ? (rawLayout as Record<string, unknown>) : {};

  const actions =
    isDefault ? null : toolbarVariant === "enterprise" ? (
      <span className="dash-resolved-actions">
        <Link to="/dashboard/list" className="dash-toolbar-link">
          All dashboards
        </Link>
        {payload?.primary_dashboard_id ? (
          <Link to={`/dashboard/${String(payload.primary_dashboard_id)}/live`} className="dash-toolbar-link">
            Open primary live
          </Link>
        ) : null}
      </span>
    ) : (
      <span className="dash-resolved-actions">
        <Link to="/dashboard/list" className="dash-toolbar-link">
          All dashboards
        </Link>
        <Link to="/dashboard/create" className="dash-toolbar-link">
          Create dashboard
        </Link>
      </span>
    );

  return (
    <PageShell className="dash-live-page device-manage-page" variant="list" actions={actions}>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {payload && !err ? (
        <div className="app-dash-frame dash-resolved-root">
          {!isDefault ? (
            <div className="app-dash-frame__toolbar">
              <DashboardLiveToolbar
                captureRef={captureRef}
                fileBaseName="dashboard"
                refreshIntervalSec={refreshSec}
                paused={paused}
                onTogglePause={() => setPaused((p) => !p)}
                onManualRefresh={() => void load({ showLoading: false })}
              />
            </div>
          ) : null}
          <div ref={captureRef} className="dash-live-capture-root dash-resolved-capture">
            {isDefault ? (
              <OperationsOverviewDefault
                widgets={Array.isArray(payload.widgets) ? payload.widgets : []}
                renderedAt={payload.rendered_at}
                syncing={syncing}
                onRefresh={refreshOpsOverview}
                commandCenter={payload.command_center ?? null}
              />
            ) : (
              <DashboardLiveRenderer
                layout={layout}
                widgets={Array.isArray(payload.widgets) ? payload.widgets : []}
                renderedAt={payload.rendered_at}
                dashboard={payload.dashboard}
                enterpriseMode={toolbarVariant === "enterprise"}
                fitPage
                layoutDensity="default"
              />
            )}
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
