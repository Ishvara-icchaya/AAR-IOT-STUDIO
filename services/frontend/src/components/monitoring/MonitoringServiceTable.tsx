import type { CSSProperties, FormEvent } from "react";
import { useMemo, useState } from "react";
import type { MonitoringServiceRow } from "@/api/monitoring";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

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

function IngressDetailCell({ row }: { row: MonitoringServiceRow }) {
  if (row.service_name === "mosquitto" && row.mqtt_connection_state) {
    return (
      <small>
        port {row.mqtt_broker_listen_port ?? "—"} · {row.mqtt_connection_state}
      </small>
    );
  }
  if (row.service_name === "worker-mqtt-bridge" && row.last_ingest_message_at) {
    return <small>last msg {new Date(row.last_ingest_message_at).toLocaleString()}</small>;
  }
  if (row.ingress_detail) {
    return <span style={{ wordBreak: "break-word", whiteSpace: "pre-line" }}>{row.ingress_detail}</span>;
  }
  return <small>—</small>;
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

  const columns = useMemo<PlainOperationalColumn<MonitoringServiceRow>[]>(() => {
    return [
      { id: "service_name", header: "Service", cell: (r) => r.service_name },
      {
        id: "protocol",
        header: "Protocol",
        cell: (r) => <span style={{ fontWeight: 600 }}>{protocolIngressLabel(r.service_type ?? "")}</span>,
      },
      {
        id: "service_type",
        header: "Type",
        cell: (r) => <small style={{ color: "var(--color-text-muted)" }}>{r.service_type}</small>,
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => <MonitoringStatusBadge status={r.status} />,
      },
      {
        id: "last_seen",
        header: "Last seen",
        cell: (r) => {
          const v = r.last_seen;
          return v ? new Date(v).toLocaleString() : "—";
        },
      },
      {
        id: "ingress_detail",
        header: "Ingress detail",
        cell: (r) => <IngressDetailCell row={r} />,
      },
      { id: "cpu_percent", header: "CPU %", cell: (r) => String(r.cpu_percent ?? "—") },
      { id: "memory_mb", header: "Memory MB", cell: (r) => String(r.memory_mb ?? "—") },
      { id: "error_count", header: "Errors", cell: (r) => String(r.error_count ?? "—") },
      { id: "active_alerts", header: "Alerts", cell: (r) => String(r.active_alerts ?? "—") },
      {
        id: "view",
        header: "",
        cell: (r) => (
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
        ),
      },
    ];
  }, [onView]);

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
      <PlainOperationalTable<MonitoringServiceRow>
        rows={filtered}
        columns={columns}
        getRowId={(r) => r.service_name}
        bordered={false}
        tableVariant="dm"
        onRowClick={(r) => onView(r.service_name)}
        resetPageKey={`${q}|${statusF}|${typeF}|${filtered.length}`}
        emptyMessage="No services reported for this environment."
      />
    </div>
  );
}
