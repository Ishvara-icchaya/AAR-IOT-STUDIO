/** Preset field names for dashboard chart bindings (data_object / timeseries payloads). */

export const CHART_X_TIME_OPTIONS: { value: string; label: string }[] = [
  { value: "t", label: "t" },
  { value: "time", label: "time" },
  { value: "ts", label: "ts" },
  { value: "timestamp", label: "timestamp" },
  { value: "created_at", label: "created_at" },
  { value: "updated_at", label: "updated_at" },
  { value: "x", label: "x" },
  { value: "date", label: "date" },
];

export const CHART_Y_VALUE_OPTIONS: { value: string; label: string }[] = [
  { value: "value", label: "value" },
  { value: "raw", label: "raw" },
  { value: "val", label: "val" },
  { value: "v", label: "v" },
  { value: "reading", label: "reading" },
  { value: "measurement", label: "measurement" },
  { value: "count", label: "count" },
  { value: "temperature", label: "temperature" },
];

export function isPresetChartXField(field: string | undefined): boolean {
  const f = String(field ?? "");
  return CHART_X_TIME_OPTIONS.some((o) => o.value === f);
}

export function isPresetChartYField(field: string | undefined): boolean {
  const f = String(field ?? "");
  return CHART_Y_VALUE_OPTIONS.some((o) => o.value === f);
}
