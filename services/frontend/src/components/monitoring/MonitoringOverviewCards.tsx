import type { MonitoringSummary } from "@/types/monitoring";
import { MonitoringMetricCard } from "./MonitoringMetricCard";

function roleStatus(summary: MonitoringSummary, key: keyof MonitoringSummary): string {
  const v = summary[key];
  return typeof v === "string" ? v : "unknown";
}

export function MonitoringOverviewCards({ summary }: { summary: MonitoringSummary }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Platform &amp; data plane</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <MonitoringMetricCard title="API" status={summary.api_status} />
        <MonitoringMetricCard title="Kafka" status={summary.kafka_status} />
        <MonitoringMetricCard title="Redis" status={summary.redis_status} />
        <MonitoringMetricCard title="MinIO" status={summary.minio_status} />
        <MonitoringMetricCard title="Postgres" status={summary.postgres_status} />
        <MonitoringMetricCard title="TimescaleDB" status={summary.timescale_status} />
      </div>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Runtime &amp; AI</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <MonitoringMetricCard title="Scheduler" status={summary.scheduler_status} />
        <MonitoringMetricCard title="Ingest" status={roleStatus(summary, "ingest_worker_status")} />
        {summary.mqtt_broker_status ? (
          <MonitoringMetricCard
            title="MQTT broker"
            status={summary.mqtt_broker_status}
            subtitle={
              summary.mqtt_broker_listen_port != null ? `port ${summary.mqtt_broker_listen_port}` : undefined
            }
          />
        ) : null}
        {summary.mqtt_bridge_status ? (
          <MonitoringMetricCard title="MQTT bridge" status={summary.mqtt_bridge_status} />
        ) : null}
        {summary.rest_ingest_status ? (
          <MonitoringMetricCard title="REST ingest" status={summary.rest_ingest_status} />
        ) : null}
        {summary.coap_listener_status ? (
          <MonitoringMetricCard title="CoAP adapter" status={summary.coap_listener_status} />
        ) : null}
        {summary.websocket_ingest_status ? (
          <MonitoringMetricCard title="WebSocket ingest" status={summary.websocket_ingest_status} />
        ) : null}
        {summary.rest_poller_status ? (
          <MonitoringMetricCard title="REST poller" status={summary.rest_poller_status} />
        ) : null}
        <MonitoringMetricCard title="Scrubber" status={roleStatus(summary, "scrubber_worker_status")} />
        <MonitoringMetricCard title="Workflow" status={roleStatus(summary, "workflow_worker_status")} />
        <MonitoringMetricCard title="Publish" status={roleStatus(summary, "publish_worker_status")} />
        <MonitoringMetricCard title="AI worker" status={roleStatus(summary, "ai_worker_status")} />
        <MonitoringMetricCard title="Ollama" status={summary.ollama_status ?? "unknown"} />
      </div>
      {summary.mqtt_last_ingest_at ? (
        <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
          Last MQTT payload archived: {new Date(summary.mqtt_last_ingest_at).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
