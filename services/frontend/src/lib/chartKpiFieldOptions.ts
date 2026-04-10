/** Build Y-axis path options from scrubber `kpi_json.metrics` (matches worker / scrubber KPI output). */

export type KpiAxisOption = { value: string; label: string };

export function optionsFromKpiJson(kpiJson: Record<string, unknown> | null | undefined): KpiAxisOption[] {
  const out: KpiAxisOption[] = [];
  const metrics = kpiJson?.metrics;
  if (!metrics || typeof metrics !== "object") return out;
  for (const [key, meta] of Object.entries(metrics as Record<string, unknown>)) {
    if (!meta || typeof meta !== "object") continue;
    const m = meta as Record<string, unknown>;
    const label = String(m.label ?? key);
    const fieldPath = String(m.field ?? "").trim();
    const yPath = fieldPath || `metrics.${key}.value`;
    out.push({ value: yPath, label: `${label} (${key})` });
  }
  return out;
}

/** Result / workflow payloads may expose `metrics` at top level without scrubber kpi_json shape. */
export function optionsFromPayloadMetrics(payload: Record<string, unknown> | null | undefined): KpiAxisOption[] {
  const out: KpiAxisOption[] = [];
  const metrics = payload?.metrics;
  if (!metrics || typeof metrics !== "object") return out;
  for (const [key, meta] of Object.entries(metrics as Record<string, unknown>)) {
    if (!meta || typeof meta !== "object") continue;
    const m = meta as Record<string, unknown>;
    const label = String(m.label ?? key);
    const fieldPath = String(m.field ?? "").trim();
    const yPath = fieldPath || `metrics.${key}.value`;
    out.push({ value: yPath, label: `${label} (${key})` });
  }
  return out;
}
