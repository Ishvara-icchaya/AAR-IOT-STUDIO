import type { CSSProperties } from "react";
import type { MonitoringAiOps, MonitoringAiPayload } from "@/api/monitoring";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
};
const td: CSSProperties = { padding: "0.5rem", borderBottom: "1px solid var(--color-border-subtle, #333)" };

function sevColor(s: string) {
  const x = s.toLowerCase();
  if (x === "critical") return "#c62828";
  if (x === "warning") return "#f9a825";
  return "var(--color-text-muted)";
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function OpsSummary({ ops }: { ops: MonitoringAiOps | undefined }) {
  if (!ops) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>No AI operations metrics in this response.</p>;
  }
  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(10rem, 14rem) 1fr",
        gap: "0.35rem 1rem",
        fontSize: "0.88rem",
        margin: 0,
      }}
    >
      <dt style={{ color: "var(--color-text-muted)", margin: 0 }}>LLM failures (1h)</dt>
      <dd style={{ margin: 0 }}>{ops.llm_failures_last_hour ?? "—"}</dd>
      <dt style={{ color: "var(--color-text-muted)", margin: 0 }}>Planner / guard failures (15m)</dt>
      <dd style={{ margin: 0 }}>{ops.planner_failures_last_15m ?? "—"}</dd>
      <dt style={{ color: "var(--color-text-muted)", margin: 0 }}>Execution / retrieval failures (15m)</dt>
      <dd style={{ margin: 0 }}>{ops.execution_failures_last_15m ?? "—"}</dd>
      <dt style={{ color: "var(--color-text-muted)", margin: 0 }}>Suggestions cache refreshed</dt>
      <dd style={{ margin: 0 }}>{formatWhen(ops.suggestions_last_refresh_utc ?? undefined)}</dd>
      <dt style={{ color: "var(--color-text-muted)", margin: 0 }}>Last AI query (customer)</dt>
      <dd style={{ margin: 0 }}>{formatWhen(ops.last_successful_ai_query_at ?? undefined)}</dd>
    </dl>
  );
}

export function MonitoringAiTable({ data }: { data: MonitoringAiPayload }) {
  return (
    <div>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>AI operations</h3>
      <div
        style={{
          marginBottom: "1.25rem",
          padding: "0.75rem",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
        }}
      >
        <OpsSummary ops={data.ops} />
      </div>
      <div style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", marginBottom: "1.5rem" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Service</th>
              <th style={th}>Status</th>
              <th style={th}>Model</th>
              <th style={th}>Req/min</th>
              <th style={th}>Avg latency (s)</th>
              <th style={th}>Compute</th>
              <th style={th}>Last error</th>
            </tr>
          </thead>
          <tbody>
            {data.services.map((s) => (
              <tr key={s.service}>
                <td style={td}>{s.service}</td>
                <td style={td}>
                  <MonitoringStatusBadge status={s.status} />
                </td>
                <td style={td}>{s.model ?? "—"}</td>
                <td style={td}>{s.requests_per_minute ?? "—"}</td>
                <td style={td}>{s.avg_latency_sec ?? "—"}</td>
                <td style={td}>{s.compute_mode ?? "—"}</td>
                <td style={td}>
                  <small>{s.last_error ?? "—"}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Recent AI issues</h3>
      {data.recent_ai_issues.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>None recorded.</p>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Time</th>
                <th style={th}>Severity</th>
                <th style={th}>Message</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_ai_issues.map((r, i) => (
                <tr key={`${r.time}-${i}`}>
                  <td style={td}>
                    <small>{new Date(r.time).toLocaleString()}</small>
                  </td>
                  <td style={{ ...td, color: sevColor(r.severity) }}>{r.severity}</td>
                  <td style={td}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
