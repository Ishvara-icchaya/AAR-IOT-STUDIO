import { useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardDefinition2 } from "@/types/dashboard2";
import { DashboardRuntimeGrid } from "./DashboardRuntimeGrid";
import { useDashboard2AutoRefresh } from "./useDashboard2AutoRefresh";

export function DashboardLiveScreen2({
  dashboard,
  dashboardId,
  canRefresh = true,
}: {
  dashboard: DashboardDefinition2;
  dashboardId: string;
  canRefresh?: boolean;
}) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(new Date().toISOString());
  const refreshSec = Math.max(
    5,
    Math.min(
      3600,
      dashboard.widgets.reduce((acc, w) => Math.min(acc, w.refreshIntervalSec ?? 30), 30),
    ),
  );

  useDashboard2AutoRefresh({
    enabled: canRefresh,
    intervalSec: refreshSec,
    onTick: () => {
      setRefreshTick((v) => v + 1);
      setLastRefreshedAt(new Date().toISOString());
    },
  });

  return (
    <section className="dashboard2-live-shell" data-refresh-tick={refreshTick}>
      <header className="dashboard2-live-shell__header">
        <div className="dashboard2-live-shell__title-row">
          <h2>{dashboard.name}</h2>
          <nav className="dashboard2-live-shell__nav" aria-label="Dashboard actions">
            <Link className="aar-btn aar-btn--outline dm-btn dm-btn--outline" to={`/dashboard2/${dashboardId}/edit`}>
              Edit
            </Link>
            <Link className="aar-btn aar-btn--outline dm-btn dm-btn--outline" to="/dashboard2/review">
              Review hub
            </Link>
            <Link
              className="aar-btn aar-btn--outline dm-btn dm-btn--outline dashboard2-live-shell__legacy"
              to={`/dashboard/${dashboardId}/edit`}
              title="Classic builder (unchanged)"
            >
              Legacy edit
            </Link>
          </nav>
        </div>
        <div className="dashboard2-live-shell__meta">
          <span>Read-only runtime</span>
          <span>Auto refresh: {canRefresh ? `${refreshSec}s` : "disabled"}</span>
          <span>Shell refresh: {new Date(lastRefreshedAt).toLocaleTimeString()}</span>
        </div>
      </header>
      <DashboardRuntimeGrid dashboard={dashboard} mode="live" refreshVersion={refreshTick} />
    </section>
  );
}
