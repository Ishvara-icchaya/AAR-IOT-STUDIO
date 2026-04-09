import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMonitoringServiceDetail } from "@/api/monitoring";
import type { MonitoringServiceDetail } from "@/types/monitoring";
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
  width: "min(520px, 100%)",
  maxHeight: "min(90vh, 720px)",
  background: "var(--color-surface, #1e1e1e)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
  padding: "1.25rem",
  overflow: "auto",
  boxShadow: "var(--shadow-glow)",
};

const metricTbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const metricTh: CSSProperties = {
  textAlign: "left",
  padding: "0.35rem 0",
  borderBottom: "1px solid var(--color-border-subtle, #333)",
  color: "var(--color-text-muted)",
};
const metricTd: CSSProperties = { padding: "0.35rem 0", borderBottom: "1px solid var(--color-border-subtle, #333)" };

export function MonitoringServiceDetailDrawer({
  serviceName,
  onClose,
}: {
  serviceName: string | null;
  onClose: () => void;
}) {
  const [row, setRow] = useState<MonitoringServiceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!serviceName) {
      setRow(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchMonitoringServiceDetail(serviceName)
      .then((d) => {
        if (!cancelled) setRow(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceName]);

  if (!serviceName) return null;

  const alerts = row?.recent_alerts?.length ? row.recent_alerts : row?.recent_issues ?? [];

  return (
    <div style={backdrop} role="presentation" onClick={onClose}>
      <aside style={panel} role="dialog" aria-modal="true" aria-label="Service detail" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Service detail: {serviceName}</h2>
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
        {loading && <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>}
        {err && <p style={{ color: "#f66" }}>{err}</p>}
        {row && !loading && (
          <div style={{ fontSize: "0.9rem" }}>
            <p>
              <strong>Status:</strong> <MonitoringStatusBadge status={row.status} />
            </p>
            <p>
              <strong>Type:</strong> {row.service_type}
            </p>
            <p>
              <strong>Last seen:</strong> {row.last_seen ? new Date(row.last_seen).toLocaleString() : "—"}
            </p>
            {row.mqtt_broker_listen_port != null ? (
              <p>
                <strong>Broker listen port:</strong> {row.mqtt_broker_listen_port}
              </p>
            ) : null}
            {row.mqtt_connection_state ? (
              <p>
                <strong>TCP connection:</strong> {row.mqtt_connection_state}
              </p>
            ) : null}
            {row.last_ingest_message_at ? (
              <p>
                <strong>Last ingested MQTT message:</strong>{" "}
                {new Date(row.last_ingest_message_at).toLocaleString()}
              </p>
            ) : null}
            {row.ingress_detail ? (
              <p>
                <strong>Ingress detail:</strong> {row.ingress_detail}
              </p>
            ) : null}
            {row.service_last_seen_key ? (
              <p>
                <strong>Heartbeat key (spec):</strong>{" "}
                <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{row.service_last_seen_key}</code>
              </p>
            ) : null}
            {row.heartbeat_key ? (
              <p>
                <strong>Heartbeat key (Redis):</strong>{" "}
                <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{row.heartbeat_key}</code>
              </p>
            ) : null}
            <p>
              <strong>CPU %:</strong> {row.cpu_percent ?? "—"}
            </p>
            <p>
              <strong>Memory MB:</strong> {row.memory_mb ?? "—"}
            </p>
            <p>
              <strong>Recent errors (warn/crit alerts):</strong> {row.error_count}
            </p>
            <p>
              <strong>Open alerts (source match):</strong> {row.active_alerts}
            </p>

            {row.recent_metrics && Object.keys(row.recent_metrics).length > 0 ? (
              <>
                <h3 style={{ fontSize: "0.95rem", marginTop: "1rem", marginBottom: "0.5rem" }}>Recent metrics</h3>
                <table style={metricTbl}>
                  <thead>
                    <tr>
                      <th style={metricTh}>Metric</th>
                      <th style={metricTh}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(row.recent_metrics).map(([k, v]) => (
                      <tr key={k}>
                        <td style={metricTd}>
                          <code style={{ fontSize: "0.8rem" }}>{k}</code>
                        </td>
                        <td style={metricTd}>{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            <h3 style={{ fontSize: "0.95rem", marginTop: "1rem", marginBottom: "0.5rem" }}>Recent alerts</h3>
            {alerts.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)" }}>None</p>
            ) : (
              <ul style={{ paddingLeft: "1.1rem", margin: 0 }}>
                {alerts.map((i) => (
                  <li key={i.alert_id} style={{ marginBottom: "0.35rem" }}>
                    <small style={{ color: "var(--color-text-muted)" }}>{new Date(i.time).toLocaleString()}</small>{" "}
                    <span style={{ textTransform: "capitalize" }}>{i.severity}</span> — {i.message}{" "}
                    <Link to={`/alerts/${i.alert_id}`} style={{ color: "var(--color-accent)" }}>
                      View
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
