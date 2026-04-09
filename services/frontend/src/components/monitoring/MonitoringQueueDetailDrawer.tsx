import type { CSSProperties } from "react";
import type { MonitoringQueueRow } from "@/types/monitoring";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 1000,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "1rem",
};

const panel: CSSProperties = {
  width: "min(480px, 100%)",
  maxHeight: "min(85vh, 560px)",
  background: "var(--color-surface, #1e1e1e)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
  padding: "1.25rem",
  overflow: "auto",
  boxShadow: "var(--shadow-glow)",
};

export function MonitoringQueueDetailDrawer({
  row,
  onClose,
}: {
  row: MonitoringQueueRow | null;
  onClose: () => void;
}) {
  if (!row) return null;

  return (
    <div style={backdrop} role="presentation" onClick={onClose}>
      <aside style={panel} role="dialog" aria-modal="true" aria-label="Queue detail" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{row.topic}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--color-text)",
              cursor: "pointer",
              fontSize: "1.25rem",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: "0.9rem" }}>
          <p>
            <strong>Type:</strong> {row.queue_type}
          </p>
          <p>
            <strong>Status:</strong> <MonitoringStatusBadge status={row.status} />
          </p>
          <p>
            <strong>Messages (log end):</strong> {row.messages ?? "—"}
          </p>
          <p>
            <strong>Lag:</strong> {row.lag ?? "—"}
          </p>
          <p>
            <strong>Consumers (heartbeat):</strong> {row.consumers ?? "—"}
          </p>
          <p>
            <strong>Last check:</strong>{" "}
            {row.last_event_at ? new Date(row.last_event_at).toLocaleString() : "—"}
          </p>
        </div>
      </aside>
    </div>
  );
}
