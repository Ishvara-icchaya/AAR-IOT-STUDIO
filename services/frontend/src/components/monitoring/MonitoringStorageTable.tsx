import type { CSSProperties } from "react";
import type { MonitoringStorageRow } from "@/api/monitoring";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
};
const td: CSSProperties = { padding: "0.5rem", borderBottom: "1px solid var(--color-border-subtle, #333)" };

export function MonitoringStorageTable({ rows }: { rows: MonitoringStorageRow[] }) {
  return (
    <div style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>Layer</th>
            <th style={th}>Status</th>
            <th style={th}>Used GB</th>
            <th style={th}>Capacity GB</th>
            <th style={th}>Last check</th>
            <th style={th}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.storage_layer}>
              <td style={td}>{r.storage_layer}</td>
              <td style={td}>
                <MonitoringStatusBadge status={r.status} />
              </td>
              <td style={td}>{r.used_gb ?? "—"}</td>
              <td style={td}>{r.capacity_gb ?? "—"}</td>
              <td style={td}>
                <small>{r.last_check ? new Date(r.last_check).toLocaleString() : "—"}</small>
              </td>
              <td style={td}>
                <small>{r.notes ?? "—"}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
