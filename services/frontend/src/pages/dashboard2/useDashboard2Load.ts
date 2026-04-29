import { useEffect, useState } from "react";
import * as dashApi from "@/api/dashboard";
import type { DashboardDefinition2 } from "@/types/dashboard2";
import { normalizeDashboard2Definition } from "@/lib/dashboard2/normalizeDashboard2Definition";

export function useDashboard2Load(dashboardId: string | undefined) {
  const [dashboard, setDashboard] = useState<DashboardDefinition2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dashboardId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const d = await dashApi.getDashboard(dashboardId);
        if (!d) throw new Error("Dashboard not found");
        if (!cancelled) setDashboard(normalizeDashboard2Definition(d));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboardId]);

  return { dashboard, setDashboard, loading, error };
}
