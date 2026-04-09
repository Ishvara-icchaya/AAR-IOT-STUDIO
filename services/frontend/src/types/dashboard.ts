export type DashboardLayoutV1 = {
  version: number;
  rows: unknown[];
};

export type DashboardListItemDTO = {
  id: string;
  site_id: string | null;
  name: string;
  status: string;
  updated_at: string;
  is_primary: boolean;
};

export type DashboardReadDTO = {
  id: string;
  customer_id: string;
  site_id: string | null;
  name: string;
  description: string | null;
  status: string;
  layout: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_primary: boolean;
};

export type DashboardLiveWidgetDTO = {
  widget_id: string;
  type: string;
  title: string;
  data: Record<string, unknown>;
};

export type DashboardLiveDTO = {
  dashboard: Record<string, unknown>;
  widgets: DashboardLiveWidgetDTO[];
  rendered_at: string;
  primary_dashboard_id?: string | null;
};
