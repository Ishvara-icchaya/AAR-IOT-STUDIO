import type { CSSProperties, FormEvent } from "react";
import { useMemo, useState } from "react";
import type { MonitoringServiceRow } from "@/api/monitoring";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
};
const td: CSSProperties = { padding: "0.5rem", borderBottom: "1px solid var(--color-border-subtle, #333)" };
const inp: CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

function protocolIngressLabel(serviceType: string): string {
  const m: Record<string, string> = {
    fastapi: "HTTP · API",
    rest_ingest: "REST · inbound",
    rest_poller: "REST · polling",
    coap_listener: "CoAP",
    websocket_ingest: "WebSocket",
    mqtt_broker: "MQTT broker",
    worker: "Worker",
    scheduler: "Scheduler",
    llm: "LLM",
  };
  return m[serviceType] ?? serviceType;
}

export function MonitoringServiceTable({
  rows,
  onView,
}: {
  rows: MonitoringServiceRow[];
  onView: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("");
  const [typeF, setTypeF] = useState("");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (q && !r.service_name.toLowerCase().includes(q.toLowerCase())) return false;
      if (statusF && r.status.toLowerCase() !== statusF.toLowerCase()) return false;
      if (typeF && r.service_type.toLowerCase() !== typeF.toLowerCase()) return false;
      return true;
    });
  }, [rows, q, statusF, typeF]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <div>
      <form onSubmit={onSubmit} style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
        <input
          placeholder="Search service name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...inp, minWidth: "180px" }}
        />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={inp}>
          <option value="">All statuses</option>
          <option value="healthy">healthy</option>
          <option value="warning">warning</option>
          <option value="critical">critical</option>
          <option value="unknown">unknown</option>
        </select>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} style={inp}>
          <option value="">All types</option>
          <option value="fastapi">fastapi</option>
          <option value="worker">worker</option>
          <option value="mqtt_broker">mqtt_broker</option>
          <option value="rest_ingest">rest_ingest</option>
          <option value="coap_listener">coap_listener</option>
          <option value="websocket_ingest">websocket_ingest</option>
          <option value="rest_poller">rest_poller</option>
          <option value="scheduler">scheduler</option>
          <option value="llm">llm</option>
        </select>
      </form>
      <div style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
        <table className="ops-data-table" style={tbl}>
          <thead>
            <tr>
              <th style={th}>Service</th>
              <th style={th}>Protocol</th>
              <th style={th}>Type</th>
              <th style={th}>Status</th>
              <th style={th}>Last seen</th>
              <th style={th}>Ingress detail</th>
              <th style={th}>CPU %</th>
              <th style={th}>Memory MB</th>
              <th style={th}>Errors</th>
              <th style={th}>Alerts</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.service_name}
                onClick={() => onView(r.service_name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onView(r.service_name);
                  }
                }}
                tabIndex={0}
                role="row"
              >
                <td style={td}>{r.service_name}</td>
                <td style={td}>
                  <strong style={{ fontWeight: 600 }}>{protocolIngressLabel(r.service_type)}</strong>
                </td>
                <td style={td}>
                  <small style={{ color: "var(--color-text-muted)" }}>{r.service_type}</small>
                </td>
                <td style={td}>
                  <MonitoringStatusBadge status={r.status} />
                </td>
                <td style={td}>
                  <small>{r.last_seen ? new Date(r.last_seen).toLocaleString() : "—"}</small>
                </td>
                <td style={td}>
                  <small>
                    {r.service_name === "mosquitto" && r.mqtt_connection_state ? (
                      <>
                        port {r.mqtt_broker_listen_port ?? "—"} · {r.mqtt_connection_state}
                      </>
                    ) : r.service_name === "worker-mqtt-bridge" && r.last_ingest_message_at ? (
                      <>last msg {new Date(r.last_ingest_message_at).toLocaleString()}</>
                    ) : r.ingress_detail ? (
                      <span style={{ wordBreak: "break-word", whiteSpace: "pre-line" }}>{r.ingress_detail}</span>
                    ) : (
                      "—"
                    )}
                  </small>
                </td>
                <td style={td}>{r.cpu_percent ?? "—"}</td>
                <td style={td}>{r.memory_mb ?? "—"}</td>
                <td style={td}>{r.error_count}</td>
                <td style={td}>{r.active_alerts}</td>
                <td style={td}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(r.service_name);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--color-accent)",
                      cursor: "pointer",
                      textDecoration: "underline",
                      padding: 0,
                      fontSize: "0.85rem",
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
    </div>
  );
}
