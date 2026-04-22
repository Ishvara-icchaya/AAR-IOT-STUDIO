/** Layout contract (camelCase in UI; backend accepts camelCase aliases). */

/** Optional presentation overrides (live view + builder config). */
export type DashboardWidgetPresentationConfig = {
  variant?: "compact" | "standard" | "full" | "dense";
  verticalAlign?: "start" | "center" | "end" | "stretch";
  vertical_align?: "start" | "center" | "end" | "stretch";
  showTitle?: boolean;
  show_title?: boolean;
  showSource?: boolean;
  show_source?: boolean;
  showUpdatedAt?: boolean;
  show_updated_at?: boolean;
  decimalPlaces?: number;
  decimal_places?: number;
  unit?: string;
  contentDensity?: "comfortable" | "compact" | "dense";
  content_density?: "comfortable" | "compact" | "dense";
};

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
  config: (Record<string, unknown> & { presentation?: DashboardWidgetPresentationConfig }) | Record<string, unknown>;
};

export type DashboardColumnModel = {
  columnId: string;
  span: number;
  widget?: DashboardWidgetModel;
};

export type DashboardRowModel = {
  rowId: string;
  /** Relative vertical share when the dashboard is fit to one viewport (live / preview). Default 1. */
  heightWeight?: number;
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
