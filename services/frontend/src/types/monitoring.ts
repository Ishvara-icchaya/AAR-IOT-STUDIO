/** Domain types for the Monitoring module (mirrors API /api/v1/monitoring). */

export type MonitoringSummary = {
  api_status: string;
  kafka_status: string;
  redis_status: string;
  minio_status: string;
  postgres_status: string;
  timescale_status: string;
  scheduler_status: string;
  worker_status: string;
  scrubber_worker_status?: string | null;
  workflow_worker_status?: string | null;
  publish_worker_status?: string | null;
  ai_worker_status?: string | null;
  ingest_worker_status?: string | null;
  mqtt_broker_status?: string | null;
  mqtt_bridge_status?: string | null;
  mqtt_broker_listen_port?: number | null;
  mqtt_last_ingest_at?: string | null;
  rest_ingest_status?: string | null;
  coap_listener_status?: string | null;
  websocket_ingest_status?: string | null;
  rest_poller_status?: string | null;
  active_alerts: number;
  cpu_percent: number | null;
  memory_percent: number | null;
  websocket_connections: number | null;
  queue_lag_messages: number | null;
  queue_status: string | null;
  load_balancer_status: string | null;
  ollama_status: string | null;
};

export type MonitoringIncident = {
  alert_id: string;
  time: string;
  component: string;
  severity: string;
  message: string;
};

export type MonitoringOverview = {
  summary: MonitoringSummary;
  recent_incidents: MonitoringIncident[];
};

export type MonitoringServiceRow = {
  service_name: string;
  service_type: string;
  status: string;
  last_seen: string | null;
  cpu_percent: number | null;
  memory_mb: number | null;
  error_count: number;
  active_alerts: number;
  mqtt_broker_listen_port?: number | null;
  mqtt_connection_state?: string | null;
  last_ingest_message_at?: string | null;
  ingress_detail?: string | null;
};

export type MonitoringQueueRow = {
  topic: string;
  queue_type: string;
  messages: number | null;
  lag: number | null;
  consumers: number | null;
  last_event_at: string | null;
  status: string;
};

export type MonitoringResourceRow = {
  component: string;
  cpu_percent: number | null;
  memory_mb: number | null;
  disk_io_mb_s: number | null;
  network_io_mb_s: number | null;
  status: string;
};

export type MonitoringStorageRow = {
  storage_layer: string;
  status: string;
  used_gb: number | null;
  capacity_gb: number | null;
  last_check: string | null;
  notes: string | null;
};

export type MonitoringAiServiceRow = {
  service: string;
  status: string;
  model: string | null;
  requests_per_minute: number | null;
  avg_latency_sec: number | null;
  compute_mode: string | null;
  last_error: string | null;
};

export type MonitoringAiOps = {
  llm_failures_last_hour?: number | null;
  planner_failures_last_15m?: number | null;
  execution_failures_last_15m?: number | null;
  suggestions_last_refresh_utc?: string | null;
  last_successful_ai_query_at?: string | null;
};

export type MonitoringAiPayload = {
  services: MonitoringAiServiceRow[];
  recent_ai_issues: { time: string; severity: string; message: string }[];
  ops?: MonitoringAiOps;
};

export type MonitoringServiceAlertItem = {
  alert_id: string;
  time: string;
  severity: string;
  message: string;
};

export type MonitoringServiceDetail = MonitoringServiceRow & {
  recent_alerts?: MonitoringServiceAlertItem[];
  recent_issues?: MonitoringServiceAlertItem[];
  recent_metrics?: Record<string, number | string>;
  heartbeat_key: string | null;
  service_last_seen_key?: string | null;
};

export type MonitoringOverviewResponse = MonitoringOverview;
