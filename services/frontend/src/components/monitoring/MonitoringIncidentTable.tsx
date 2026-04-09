import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { MonitoringIncident } from "@/types/monitoring";

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
  if (x === "info") return "#64b5f6";
  return "var(--color-text-muted)";
}

export function MonitoringIncidentTable({ items }: { items: MonitoringIncident[] }) {
  if (!items.length) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>No recent incidents in alert history.</p>;
  }
  return (
    <div style={{ overflow: "auto" }}>
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>Time</th>
            <th style={th}>Component</th>
            <th style={th}>Severity</th>
            <th style={th}>Message</th>
            <th style={th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.alert_id}>
              <td style={td}>
                <small>{new Date(r.time).toLocaleString()}</small>
              </td>
              <td style={td}>{r.component}</td>
              <td style={{ ...td, color: sevColor(r.severity), fontWeight: 600 }}>{r.severity}</td>
              <td style={td}>{r.message}</td>
              <td style={td}>
                <Link to={`/alerts/${r.alert_id}`} style={{ color: "var(--color-accent)" }}>
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
