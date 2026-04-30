/** Dashboard widget runtime contract (docs/DASHBOARD_WIDGET_CONTRACT.md). All API fields camelCase. */

export type WidgetPayloadStatus = "ok" | "empty" | "degraded" | "error";

export type DashboardWidgetSourceDTO = {
  sourceType?: string;
  siteId?: string | null;
  endpointId?: string | null;
  objectName?: string | null;
};

export type DashboardWidgetPayloadMetaDTO = {
  warnings?: string[];
  emptyReason?: string | null;
  latencyMs?: number | null;
};

export type DashboardWidgetPayloadDTO = {
  widgetId: string;
  widgetType: string;
  status: WidgetPayloadStatus;
  title?: string | null;
  subtitle?: string | null;
  message?: string | null;
  generatedAt: string;
  source: DashboardWidgetSourceDTO;
  data: unknown;
  meta?: DashboardWidgetPayloadMetaDTO | null;
};

export type DashboardRuntimeLayoutDTO = {
  dashboard: {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    siteId?: string | null;
    layout: Record<string, unknown>;
    settings: Record<string, unknown>;
  };
  renderedAt: string;
};

export type DashboardWidgetsResolveBatchRequestDTO = {
  dashboardId: string;
  widgets: { widgetId: string }[];
  dashboardLayoutDraft?: Record<string, unknown> | null;
  scopeHours?: number | null;
};

export type DashboardWidgetsResolveBatchResponseDTO = {
  widgets: DashboardWidgetPayloadDTO[];
  batchGeneratedAt: string;
};
