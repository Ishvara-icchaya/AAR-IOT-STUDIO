import type { MonitoringSummary } from "@/types/monitoring";
import { MonitoringMetricCard } from "./MonitoringMetricCard";
import "./monitoring-overview-v2.css";

type Props = {
  summary: MonitoringSummary;
  /** Epoch ms when overview payload was last received (client clock). */
  lastFetchedAt: number | null;
};

function statusTier(s: string): "ok" | "warn" | "bad" | "unk" {
  const x = s.toLowerCase();
  if (x.includes("health") || x === "ok" || x === "up" || x === "running") return "ok";
  if (x.includes("warn") || x.includes("degraded")) return "warn";
  if (x.includes("down") || x.includes("error") || x.includes("fail") || x.includes("crit")) return "bad";
  return "unk";
}

function aggregatePlatformHealth(summary: MonitoringSummary): "healthy" | "degraded" | "critical" {
  const keys: (keyof MonitoringSummary)[] = [
    "api_status",
    "kafka_status",
    "redis_status",
    "postgres_status",
    "minio_status",
    "worker_status",
    "scheduler_status",
    "timescale_status",
    "ollama_status",
  ];
  let worst: 0 | 1 | 2 = 0;
  for (const k of keys) {
    const t = statusTier(String(summary[k] ?? ""));
    if (t === "bad") worst = 2;
    else if (t === "warn" && worst < 2) worst = 1;
  }
  if (summary.active_alerts > 0 && worst < 2) worst = 1;
  if (worst === 2) return "critical";
  if (worst === 1) return "degraded";
  return "healthy";
}

function formatRelativeIngest(iso: string | null | undefined): string {
  if (!iso) return "No recent MQTT archive";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = Date.now() - t;
  if (d < 45_000) return "Just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  return new Date(iso).toLocaleString();
}

function aiSummaryLine(summary: MonitoringSummary): string {
  const o = summary.ollama_status ?? "unknown";
  const w = summary.ai_worker_status ?? "unknown";
  return `Ollama: ${o} · AI worker: ${w}`;
}

function lagBarPercent(lag: number | null | undefined): number {
  if (lag == null || Number.isNaN(lag)) return 0;
  const capped = Math.min(100, (Math.log10(1 + lag) / Math.log10(1 + 5000)) * 100);
  return Math.round(capped * 10) / 10;
}

const MATRIX_KEYS: { key: keyof MonitoringSummary; label: string }[] = [
  { key: "api_status", label: "API" },
  { key: "kafka_status", label: "Kafka" },
  { key: "redis_status", label: "Redis" },
  { key: "postgres_status", label: "PG" },
  { key: "worker_status", label: "Worker" },
  { key: "mqtt_broker_status", label: "MQTT" },
  { key: "timescale_status", label: "TS" },
  { key: "minio_status", label: "MinIO" },
];

export function MonitoringOverviewV2({ summary, lastFetchedAt }: Props) {
  const health = aggregatePlatformHealth(summary);
  const lag = summary.queue_lag_messages;
  const lagPct = lagBarPercent(lag ?? null);

  return (
    <div className="monitoring-overview-v2">
      <section aria-label="Command strip">
        <div className="monitoring-overview-v2__command">
          <div className="monitoring-overview-v2__command-cell">
            <div className="monitoring-overview-v2__command-label">Overall platform health</div>
            <div className="monitoring-overview-v2__command-value">
              <span
                className={`monitoring-overview-v2__health-pill monitoring-overview-v2__health-pill--${
                  health === "healthy" ? "healthy" : health === "degraded" ? "degraded" : "critical"
                }`}
              >
                {health}
              </span>
            </div>
          </div>
          <div className="monitoring-overview-v2__command-cell">
            <div className="monitoring-overview-v2__command-label">Active alerts</div>
            <div className="monitoring-overview-v2__command-value">{summary.active_alerts}</div>
            <div className="monitoring-overview-v2__command-sub">Open in alert history</div>
          </div>
          <div className="monitoring-overview-v2__command-cell">
            <div className="monitoring-overview-v2__command-label">Ingest activity</div>
            <div className="monitoring-overview-v2__command-value">{formatRelativeIngest(summary.mqtt_last_ingest_at)}</div>
            <div className="monitoring-overview-v2__command-sub">Last MQTT payload archived (overview)</div>
          </div>
          <div className="monitoring-overview-v2__command-cell">
            <div className="monitoring-overview-v2__command-label">Kafka lag</div>
            <div className="monitoring-overview-v2__command-value">
              {lag != null ? `${lag} msgs` : "—"}
            </div>
            <div className="monitoring-overview-v2__command-sub">{summary.queue_status ?? "queue status"}</div>
          </div>
          <div className="monitoring-overview-v2__command-cell">
            <div className="monitoring-overview-v2__command-label">AI / LLM</div>
            <div className="monitoring-overview-v2__command-value" style={{ fontSize: "0.78rem", fontWeight: 700 }}>
              {aiSummaryLine(summary)}
            </div>
          </div>
          <div className="monitoring-overview-v2__command-cell">
            <div className="monitoring-overview-v2__command-label">Last refresh</div>
            <div className="monitoring-overview-v2__command-value" style={{ fontSize: "0.85rem" }}>
              {lastFetchedAt != null ? new Date(lastFetchedAt).toLocaleString() : "—"}
            </div>
            <div className="monitoring-overview-v2__command-sub">Client receive time</div>
          </div>
        </div>
      </section>

      <section aria-label="Platform health">
        <h2 className="monitoring-overview-v2__section-title">Platform health</h2>
        <div className="monitoring-overview-v2__platform-grid">
          <MonitoringMetricCard title="API" status={summary.api_status} />
          <MonitoringMetricCard title="Kafka" status={summary.kafka_status} />
          <MonitoringMetricCard title="Redis" status={summary.redis_status} />
          <MonitoringMetricCard title="Postgres" status={summary.postgres_status} />
          <MonitoringMetricCard title="MinIO" status={summary.minio_status} />
          <MonitoringMetricCard title="Workers" status={summary.worker_status} />
          <MonitoringMetricCard title="Scheduler" status={summary.scheduler_status} />
          <MonitoringMetricCard title="Ollama" status={summary.ollama_status ?? "unknown"} />
        </div>
      </section>

      <section aria-label="Operations snapshot">
        <h2 className="monitoring-overview-v2__section-title">Operations</h2>
        <div className="monitoring-overview-v2__ops-row">
          <div className="monitoring-overview-v2__ops-card">
            <div className="monitoring-overview-v2__ops-card-title">API latency</div>
            <div className="monitoring-overview-v2__ops-metric">—</div>
            <p className="monitoring-overview-v2__ops-note">
              Per-request latency is not included in the overview payload. Use Services → API row for live service metrics.
            </p>
          </div>
          <div className="monitoring-overview-v2__ops-card">
            <div className="monitoring-overview-v2__ops-card-title">Ingest throughput</div>
            <div className="monitoring-overview-v2__ops-metric" style={{ fontSize: "0.8rem", fontWeight: 700 }}>
              Ingest {summary.ingest_worker_status ?? "—"} · Bridge {summary.mqtt_bridge_status ?? "—"} · REST{" "}
              {summary.rest_ingest_status ?? "—"}
            </div>
            <p className="monitoring-overview-v2__ops-note">
              Qualitative worker path status from overview. Rates require pipeline / queue tabs.
            </p>
          </div>
          <div className="monitoring-overview-v2__ops-card">
            <div className="monitoring-overview-v2__ops-card-title">Kafka lag</div>
            <div className="monitoring-overview-v2__ops-metric">{lag != null ? `${lag} msgs` : "—"}</div>
            <div className="monitoring-overview-v2__lag-track" aria-hidden>
              <div className="monitoring-overview-v2__lag-fill" style={{ width: `${lagPct}%` }} />
            </div>
            <p className="monitoring-overview-v2__ops-note">Log-scale hint vs backlog · {summary.queue_status ?? "—"}</p>
          </div>
        </div>
      </section>

      <section aria-label="Resources and subsystem matrix">
        <h2 className="monitoring-overview-v2__section-title">Resources &amp; subsystems</h2>
        <div className="monitoring-overview-v2__resource-row">
          <div className="monitoring-overview-v2__resource-panel">
            <div className="monitoring-overview-v2__section-title" style={{ marginBottom: "0.35rem" }}>
              Resource utilization
            </div>
            <div className="monitoring-overview-v2__meter">
              <div className="monitoring-overview-v2__meter-head">
                <span>CPU (host / API process)</span>
                <span className="monitoring-overview-v2__meter-val">
                  {summary.cpu_percent != null ? `${summary.cpu_percent}%` : "n/a"}
                </span>
              </div>
              <div className="monitoring-overview-v2__meter-track">
                <div
                  className="monitoring-overview-v2__meter-fill"
                  style={{ width: `${Math.min(100, Math.max(0, summary.cpu_percent ?? 0))}%` }}
                />
              </div>
            </div>
            <div className="monitoring-overview-v2__meter">
              <div className="monitoring-overview-v2__meter-head">
                <span>Memory (host %)</span>
                <span className="monitoring-overview-v2__meter-val">
                  {summary.memory_percent != null ? `${summary.memory_percent}%` : "n/a"}
                </span>
              </div>
              <div className="monitoring-overview-v2__meter-track">
                <div
                  className="monitoring-overview-v2__meter-fill"
                  style={{ width: `${Math.min(100, Math.max(0, summary.memory_percent ?? 0))}%` }}
                />
              </div>
            </div>
          </div>
          <div className="monitoring-overview-v2__matrix-panel">
            <div className="monitoring-overview-v2__section-title" style={{ marginBottom: 0 }}>
              Subsystem health matrix
            </div>
            <div className="monitoring-overview-v2__matrix-grid">
              {MATRIX_KEYS.map(({ key, label }) => {
                const raw = String(summary[key] ?? "");
                const tier = statusTier(raw);
                const dot =
                  tier === "ok"
                    ? "monitoring-overview-v2__matrix-dot--ok"
                    : tier === "warn"
                      ? "monitoring-overview-v2__matrix-dot--warn"
                      : tier === "bad"
                        ? "monitoring-overview-v2__matrix-dot--bad"
                        : "monitoring-overview-v2__matrix-dot--unk";
                return (
                  <div key={String(key)} className="monitoring-overview-v2__matrix-cell" title={`${label}: ${raw || "—"}`}>
                    <span className={`monitoring-overview-v2__matrix-dot ${dot}`} aria-hidden />
                    <span className="monitoring-overview-v2__matrix-label">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
