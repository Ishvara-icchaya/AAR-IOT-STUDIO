export type KpiMetric = {
  id: string;
  label: string;
  value: string;
  sub?: string;
  deltaPct?: number;
  status?: "ok" | "warn" | "crit";
};

export type SiteAlarm = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  site: string;
  asset: string;
  at: string;
};

export type TelemetryPoint = { t: string; v: number };

export type RecentEvent = {
  id: string;
  ts: string;
  type: string;
  device: string;
  message: string;
  severity: "info" | "warning" | "error";
};

export const MOCK_KPIS: KpiMetric[] = [
  { id: "1", label: "Active devices", value: "1,284", sub: "edge + cloud", deltaPct: 2.1, status: "ok" },
  { id: "2", label: "Messages / min", value: "48.2k", sub: "MQTT + HTTP", deltaPct: -0.8, status: "ok" },
  { id: "3", label: "Avg latency", value: "124 ms", sub: "p95 ingest", deltaPct: -4.2, status: "ok" },
  { id: "4", label: "Open alarms", value: "7", sub: "2 critical", deltaPct: undefined, status: "warn" },
];

export const MOCK_ALARMS: SiteAlarm[] = [
  {
    id: "a1",
    severity: "critical",
    title: "Motor bearing temp high",
    site: "Plant A — Line 3",
    asset: "MTR-2041",
    at: "2 min ago",
  },
  {
    id: "a2",
    severity: "warning",
    title: "Vibration RMS above threshold",
    site: "Plant B",
    asset: "PMP-118",
    at: "14 min ago",
  },
  {
    id: "a3",
    severity: "info",
    title: "Firmware rollout paused",
    site: "Fleet",
    asset: "batch-7f3a",
    at: "1 hr ago",
  },
];

export function buildSeries(hours: number, base: number, variance: number): TelemetryPoint[] {
  const out: TelemetryPoint[] = [];
  const now = Date.now();
  for (let i = hours; i >= 0; i--) {
    const t = new Date(now - i * 3600_000);
    const noise = (Math.sin(i / 2) + Math.random() * 0.4 - 0.2) * variance;
    out.push({
      t: t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      v: Math.round(base + noise),
    });
  }
  return out;
}

export const MOCK_POWER_SERIES = buildSeries(24, 820, 45);
export const MOCK_TEMP_SERIES = buildSeries(24, 62, 6);

export const MOCK_EVENTS: RecentEvent[] = [
  {
    id: "e1",
    ts: "14:02:11",
    type: "threshold",
    device: "VIB-0092",
    message: "RMS exceeded 4.5 mm/s for 3 samples",
    severity: "warning",
  },
  {
    id: "e2",
    ts: "13:58:40",
    type: "connect",
    device: "GW-west-04",
    message: "Gateway reconnected — TLS session resumed",
    severity: "info",
  },
  {
    id: "e3",
    ts: "13:51:02",
    type: "command",
    device: "PLC-12",
    message: "Remote setpoint rejected — interlock ENG-1",
    severity: "error",
  },
  {
    id: "e4",
    ts: "13:44:18",
    type: "ota",
    device: "fleet/batch-12",
    message: "OTA 2.4.1 staged for 312 devices",
    severity: "info",
  },
  {
    id: "e5",
    ts: "13:39:55",
    type: "health",
    device: "CH-07",
    message: "Compressor health → yellow (suction pressure)",
    severity: "warning",
  },
];
