import type { CSSProperties } from "react";
import type { MonitoringQueueRow } from "@/types/monitoring";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
};
const td: CSSProperties = { padding: "0.5rem", borderBottom: "1px solid var(--color-border-subtle, #333)" };

export function MonitoringQueueTable({
  rows,
  onView,
}: {
  rows: MonitoringQueueRow[];
  onView: (row: MonitoringQueueRow) => void;
}) {
  if (!rows.length) {
    return <p style={{ color: "var(--color-text-muted)" }}>Kafka unreachable or no queue data.</p>;
  }
  return (
    <div style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>Topic</th>
            <th style={th}>Type</th>
            <th style={th}>Messages (log)</th>
            <th style={th}>Lag</th>
            <th style={th}>Consumers (hb)</th>
            <th style={th}>Last check</th>
            <th style={th}>Status</th>
            <th style={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.topic}>
              <td style={td}>{r.topic}</td>
              <td style={td}>{r.queue_type}</td>
              <td style={td}>{r.messages ?? "—"}</td>
              <td style={td}>{r.lag ?? "—"}</td>
              <td style={td}>{r.consumers ?? "—"}</td>
              <td style={td}>
                <small>{r.last_event_at ? new Date(r.last_event_at).toLocaleString() : "—"}</small>
              </td>
              <td style={td}>
                <MonitoringStatusBadge status={r.status} />
              </td>
              <td style={td}>
                <button
                  type="button"
                  onClick={() => onView(r)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--color-accent)",
                    cursor: "pointer",
                    padding: 0,
                    font: "inherit",
                    textDecoration: "underline",
                  }}
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
