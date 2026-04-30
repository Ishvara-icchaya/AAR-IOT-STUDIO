/**
 * Presentation-only numeric formatting (MAP_POPUP_TREND_WINDOWS_CONTRACT §3).
 */

export type MetricFieldMeta = {
  key?: string;
  label?: string;
  type?: "integer" | "float" | "string" | "code" | "id" | "enum" | string;
  unit?: string;
  /** Decimal places when type is float; default 2 */
  decimals?: number;
};

const EM_DASH = "—";

export function formatMetricValue(value: unknown, fieldMeta?: MetricFieldMeta | null): string {
  if (value === null || value === undefined) return EM_DASH;

  const t = (fieldMeta?.type ?? "").toLowerCase();
  if (t === "integer") {
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value));
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return String(Math.round(Number(value)));
    }
    return String(value);
  }
  if (t === "float" || t === "") {
    if (typeof value === "number" && Number.isFinite(value)) {
      const d = typeof fieldMeta?.decimals === "number" ? fieldMeta.decimals : 2;
      return value.toFixed(Math.max(0, Math.min(8, d)));
    }
    const n = typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n)) {
      const d = typeof fieldMeta?.decimals === "number" ? fieldMeta.decimals : 2;
      return n.toFixed(Math.max(0, Math.min(8, d)));
    }
  }
  if (t === "string" || t === "code" || t === "id" || t === "enum") {
    return String(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = typeof fieldMeta?.decimals === "number" ? fieldMeta.decimals : 2;
    return Number.isInteger(value) ? String(value) : value.toFixed(Math.max(0, Math.min(8, d)));
  }
  return String(value);
}
