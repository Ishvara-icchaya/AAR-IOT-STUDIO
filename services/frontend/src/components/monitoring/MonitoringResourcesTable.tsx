import type { CSSProperties } from "react";
import type { MonitoringResourceRow } from "@/api/monitoring";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
};
const td: CSSProperties = { padding: "0.5rem", borderBottom: "1px solid var(--color-border-subtle, #333)" };

export function MonitoringResourcesTable({ rows }: { rows: MonitoringResourceRow[] }) {
  return (
    <div
      className="table-scroll-sticky"
      style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}
    >
      <table style={tbl}>
        <thead>
          <tr>
            <th style={th}>Component</th>
            <th style={th}>CPU %</th>
            <th style={th}>Memory MB</th>
            <th style={th}>Disk I/O MB/s</th>
            <th style={th}>Net I/O MB/s</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.component}>
              <td style={td}>{r.component}</td>
              <td style={td}>{r.cpu_percent ?? "—"}</td>
              <td style={td}>{r.memory_mb ?? "—"}</td>
              <td style={td}>{r.disk_io_mb_s ?? "—"}</td>
              <td style={td}>{r.network_io_mb_s ?? "—"}</td>
              <td style={td}>
                <MonitoringStatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
