export type SummarySegment = { tone: string; text: string };

export type KpiCardExtra = {
  id: string;
  delta_pct: number | null;
  delta_label: string | null;
  sparkline: number[];
};

export type IngestionPoint = { label?: string; count?: number; rate_per_min?: number };
export type LatencyPoint = { label?: string; latency_ms?: number };

export type HealthDistribution = { online: number; degraded: number; offline: number; total: number };

export type TopAlertDevice = { device_name: string; count: number };

export type CommandCenterPayload = {
  summary_segments: SummarySegment[];
  kpi_cards: KpiCardExtra[];
  ingestion_series: IngestionPoint[];
  latency_series: LatencyPoint[];
  health_distribution: HealthDistribution | null;
  top_alert_devices: TopAlertDevice[];
  data_volume_24h: number;
  system_uptime_pct: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export function parseCommandCenter(raw: Record<string, unknown> | null | undefined): CommandCenterPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const segs = Array.isArray(raw.summary_segments)
    ? (raw.summary_segments as unknown[]).map((s) => {
        const o = s as Record<string, unknown>;
        return { tone: String(o.tone ?? "good"), text: String(o.text ?? "") };
      })
    : [];
  const kpi_cards = Array.isArray(raw.kpi_cards)
    ? (raw.kpi_cards as unknown[]).map((c) => {
        const o = c as Record<string, unknown>;
        const sp = Array.isArray(o.sparkline) ? (o.sparkline as unknown[]).map((n) => Number(n) || 0) : [];
        return {
          id: String(o.id ?? ""),
          delta_pct: o.delta_pct === null || o.delta_pct === undefined ? null : num(o.delta_pct),
          delta_label: o.delta_label == null ? null : String(o.delta_label),
          sparkline: sp,
        };
      })
    : [];
  const ingestion_series = Array.isArray(raw.ingestion_series)
    ? (raw.ingestion_series as IngestionPoint[])
    : [];
  const latency_series = Array.isArray(raw.latency_series) ? (raw.latency_series as LatencyPoint[]) : [];
  const hd = raw.health_distribution;
  let health_distribution: HealthDistribution | null = null;
  if (hd && typeof hd === "object") {
    const h = hd as Record<string, unknown>;
    health_distribution = {
      online: num(h.online) ?? 0,
      degraded: num(h.degraded) ?? 0,
      offline: num(h.offline) ?? 0,
      total: num(h.total) ?? 1,
    };
  }
  const top_alert_devices = Array.isArray(raw.top_alert_devices)
    ? (raw.top_alert_devices as unknown[]).map((r) => {
        const o = r as Record<string, unknown>;
        return { device_name: String(o.device_name ?? ""), count: num(o.count) ?? 0 };
      })
    : [];
  return {
    summary_segments: segs,
    kpi_cards,
    ingestion_series,
    latency_series,
    health_distribution,
    top_alert_devices,
    data_volume_24h: num(raw.data_volume_24h) ?? 0,
    system_uptime_pct: raw.system_uptime_pct === null || raw.system_uptime_pct === undefined ? null : num(raw.system_uptime_pct),
  };
}
