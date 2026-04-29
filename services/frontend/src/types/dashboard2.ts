export type Dashboard2Status = "draft" | "published" | "archived";

export type DashboardWidgetType2 =
  | "kpi"
  | "location_heading_map"
  | "time_series_chart"
  | "data_table"
  | "health_summary"
  | "alert_feed"
  | "trend_panel"
  | "text";

export type DashboardLayoutItem2 = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
};

export type DashboardLayouts2 = {
  lg: DashboardLayoutItem2[];
  md: DashboardLayoutItem2[];
  sm: DashboardLayoutItem2[];
};

export type ResolvedDeviceCollectionBinding2 = {
  sourceType: "resolved_device_collection";
  endpointId: string;
  siteId: string;
  objectName: string;
  filters?: {
    lifecycleStatus?: string[];
    healthStatus?: string[];
    deviceType?: string[];
  };
};

export type IndividualDeviceBinding2 = {
  sourceType: "individual_device";
  resolvedDeviceId: string;
  siteId: string;
};

export type ReportingObjectBinding2 = {
  sourceType: "reporting_object";
  reportingObjectId: string;
  siteId: string;
};

export type DashboardWidgetBinding2 =
  | ResolvedDeviceCollectionBinding2
  | IndividualDeviceBinding2
  | ReportingObjectBinding2;

export type DashboardWidgetInstance2 = {
  id: string;
  type: DashboardWidgetType2;
  title: string;
  description?: string;
  binding: DashboardWidgetBinding2;
  config: Record<string, unknown>;
  refreshIntervalSec?: number;
  createdAt: string;
  updatedAt: string;
};

export type DashboardDefinition2 = {
  id: string;
  name: string;
  description?: string;
  customerId: string;
  siteId?: string;
  version: number;
  status: Dashboard2Status;
  layouts: DashboardLayouts2;
  widgets: DashboardWidgetInstance2[];
  createdAt: string;
  updatedAt: string;
};
