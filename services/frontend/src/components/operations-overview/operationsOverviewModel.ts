import type { DashboardLiveWidgetDTO } from "@/types/dashboard";

export type OpsOverviewKpiData = {
  total_devices?: number;
  online?: number;
  degraded?: number;
  offline?: number;
  last_data_relative?: string;
  last_device_name?: string | null;
};

export type OpsTrendDay = {
  day?: string;
  label?: string;
  warning?: number;
  critical?: number;
};

export type OpsAlertItem = {
  severity?: string;
  title?: string;
  device_name?: string | null;
  site_name?: string | null;
  created_at?: string | null;
};

export type OpsActivityItem = {
  object_name?: string;
  event_type?: string;
  summary?: string;
  timestamp?: string | null;
};

export type OpsDeviceRow = {
  device_name?: string;
  site_name?: string;
  status?: string;
  last_seen?: string | null;
};

export function findWidget(widgets: DashboardLiveWidgetDTO[], type: string): DashboardLiveWidgetDTO | null {
  const t = type.trim().toLowerCase();
  return widgets.find((w) => String(w.type || "").toLowerCase() === t) ?? null;
}
