import { useState } from "react";
import type { DashboardDefinition2 } from "@/types/dashboard2";
import { DashboardRuntimeGrid } from "./DashboardRuntimeGrid";
import { useDashboard2AutoRefresh } from "./useDashboard2AutoRefresh";

export function DashboardLiveScreen2({
  dashboard,
  canRefresh = true,
}: {
  dashboard: DashboardDefinition2;
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
        <h2>{dashboard.name}</h2>
        <div className="dashboard2-live-shell__meta">
          <span>Read-only runtime</span>
          <span>Auto refresh: {canRefresh ? `${refreshSec}s` : "disabled"}</span>
          <span>Last refresh: {new Date(lastRefreshedAt).toLocaleTimeString()}</span>
        </div>
      </header>
      <DashboardRuntimeGrid dashboard={dashboard} mode="live" />
    </section>
  );
}
