import { useMemo } from "react";
import type { MonitoringAiPayload, MonitoringAiServiceRow } from "@/api/monitoring";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

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

function OpsSummary({ ops }: { ops: MonitoringAiPayload["ops"] }) {
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

type AiIssueRow = MonitoringAiPayload["recent_ai_issues"][number] & { _rowId: string };

export function MonitoringAiTable({ data }: { data: MonitoringAiPayload }) {
  const serviceColumns = useMemo<PlainOperationalColumn<MonitoringAiServiceRow>[]>(
    () => [
      { id: "service", header: "Service", cell: (r) => r.service },
      {
        id: "status",
        header: "Status",
        cell: (r) => <MonitoringStatusBadge status={r.status} />,
      },
      { id: "model", header: "Model", cell: (r) => String(r.model ?? "—") },
      { id: "requests_per_minute", header: "Req/min", cell: (r) => String(r.requests_per_minute ?? "—") },
      { id: "avg_latency_sec", header: "Avg latency (s)", cell: (r) => String(r.avg_latency_sec ?? "—") },
      { id: "compute_mode", header: "Compute", cell: (r) => String(r.compute_mode ?? "—") },
      {
        id: "last_error",
        header: "Last error",
        cell: (r) => <small>{r.last_error ?? "—"}</small>,
      },
    ],
    [],
  );

  const issueRows: AiIssueRow[] = useMemo(
    () =>
      data.recent_ai_issues.map((r, i) => ({
        ...r,
        _rowId: `${i}-${r.time}-${r.message.slice(0, 32)}`,
      })),
    [data.recent_ai_issues],
  );

  const issueColumns = useMemo<PlainOperationalColumn<AiIssueRow>[]>(
    () => [
      {
        id: "time",
        header: "Time",
        cell: (r) => {
          try {
            return new Date(r.time).toLocaleString();
          } catch {
            return r.time;
          }
        },
      },
      {
        id: "severity",
        header: "Severity",
        cell: (r) => <span style={{ color: sevColor(r.severity) }}>{r.severity}</span>,
      },
      { id: "message", header: "Message", cell: (r) => r.message },
    ],
    [],
  );

  return (
    <div style={{ padding: "0.35rem 0.15rem 0.5rem" }}>
      <h3 className="monitoring-ai-section-title">AI operations</h3>
      <div className="monitoring-ai-summary-card">
        <OpsSummary ops={data.ops} />
      </div>
      <div style={{ marginBottom: "1.25rem" }}>
        <PlainOperationalTable<MonitoringAiServiceRow>
          rows={data.services}
          columns={serviceColumns}
          getRowId={(r) => r.service}
          bordered={false}
          tableVariant="dm"
          emptyMessage="No AI services in this response."
        />
      </div>
      <h3 className="monitoring-ai-section-title">Recent AI issues</h3>
      {issueRows.length === 0 ? (
        <p className="dm-empty" style={{ margin: "0.35rem 0 0" }}>
          None recorded.
        </p>
      ) : (
        <PlainOperationalTable<AiIssueRow>
          rows={issueRows}
          columns={issueColumns}
          getRowId={(r) => r._rowId}
          bordered={false}
          tableVariant="dm"
        />
      )}
    </div>
  );
}
