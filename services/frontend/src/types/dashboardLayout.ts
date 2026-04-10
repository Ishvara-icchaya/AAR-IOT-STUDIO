/** Layout contract (camelCase in UI; backend accepts camelCase aliases). */

export type DashboardWidgetBinding = {
  sourceType?: "data_object" | "result_object";
  sourceId?: string;
  fields?: string[];
  metric?: string;
  chartType?: "line" | "bar" | "area" | "stacked_bar" | "histogram";
  /** Filter points: `1h` | `24h` | `7d` | `all` (server resolves against X timestamps). */
  chartTimeWindow?: string;
  xField?: string;
  yField?: string;
  latitudeField?: string;
  longitudeField?: string;
  titleField?: string;
  healthField?: string;
  kpiFields?: string[];
};

export type DashboardWidgetModel = {
  widgetId: string;
  type: string;
  title: string;
  binding: DashboardWidgetBinding & Record<string, unknown>;
  config: Record<string, unknown>;
};

export type DashboardColumnModel = {
  columnId: string;
  span: number;
  widget?: DashboardWidgetModel;
};

export type DashboardRowModel = {
  rowId: string;
  columns: DashboardColumnModel[];
};

export type DashboardLayoutSettings = {
  /** Auto-refresh interval for live views (seconds), clamped server-side 5–3600 */
  refreshIntervalSec?: number;
  /** MapLibre style URL override for this dashboard */
  mapStyleUrl?: string;
};

export type DashboardLayoutModel = {
  version: number;
  rows: DashboardRowModel[];
  settings?: DashboardLayoutSettings;
};
