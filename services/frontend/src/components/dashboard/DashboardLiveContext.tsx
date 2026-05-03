import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_MAP_STYLE_URL } from "@/lib/dashboardMapStyle";

export type DashboardLiveRuntimeValue = {
  mapStyleUrl: string;
  usesDefaultDemoTiles?: boolean;
  /** Enterprise landing: map widget shows side panel with paginated site counts. */
  enterpriseMode?: boolean;
  /** ISO timestamp from last live/preview resolve; changes when dashboard data is refreshed. */
  renderedAt?: string;
  /** Dashboard settings auto-refresh interval (seconds); used by map marker refetch and marker detail polling. */
  refreshIntervalSec?: number;
};

export const DashboardLiveContext = createContext<DashboardLiveRuntimeValue | null>(null);

export function DashboardLiveProvider({
  value,
  children,
}: {
  value: DashboardLiveRuntimeValue;
  children: ReactNode;
}) {
  return <DashboardLiveContext.Provider value={value}>{children}</DashboardLiveContext.Provider>;
}

export function useDashboardLiveRuntime(): DashboardLiveRuntimeValue {
  const v = useContext(DashboardLiveContext);
  if (v) return v;
  const env = import.meta.env.VITE_DASHBOARD_MAP_STYLE_URL;
  return {
    mapStyleUrl: typeof env === "string" && env.trim() ? env.trim() : DEFAULT_MAP_STYLE_URL,
    enterpriseMode: false,
    renderedAt: undefined,
    refreshIntervalSec: undefined,
  };
}
