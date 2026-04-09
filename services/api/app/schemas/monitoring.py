"""OpenAPI shapes for /monitoring/* (Phase 1 — many fields optional until collectors land)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MonitoringIncidentItem(BaseModel):
    alert_id: str
    time: str
    component: str
    severity: str
    message: str


class MonitoringSummary(BaseModel):
    api_status: str
    kafka_status: str
    redis_status: str
    minio_status: str
    postgres_status: str
    timescale_status: str
    scheduler_status: str
    worker_status: str
    scrubber_worker_status: str | None = None
    workflow_worker_status: str | None = None
    publish_worker_status: str | None = None
    ai_worker_status: str | None = None
    ingest_worker_status: str | None = None
    mqtt_broker_status: str | None = None
    mqtt_bridge_status: str | None = None
    mqtt_broker_listen_port: int | None = None
    mqtt_last_ingest_at: str | None = None
    rest_ingest_status: str | None = None
    coap_listener_status: str | None = None
    websocket_ingest_status: str | None = None
    rest_poller_status: str | None = None
    active_alerts: int
    cpu_percent: float | None = None
    memory_percent: float | None = None
    websocket_connections: int | None = None
    queue_lag_messages: int | None = None
    queue_status: str | None = None
    load_balancer_status: str | None = None
    ollama_status: str | None = None


class MonitoringOverviewResponse(BaseModel):
    summary: MonitoringSummary
    recent_incidents: list[MonitoringIncidentItem]


class MonitoringServiceRow(BaseModel):
    service_name: str
    service_type: str
    status: str
    last_seen: str | None = None
    cpu_percent: float | None = None
    memory_mb: float | None = None
    error_count: int = 0
    active_alerts: int = 0
    mqtt_broker_listen_port: int | None = None
    mqtt_connection_state: str | None = None
    last_ingest_message_at: str | None = None
    ingress_detail: str | None = None


class MonitoringQueueRow(BaseModel):
    topic: str
    queue_type: str
    messages: int | None = None
    lag: int | None = None
    consumers: int | None = None
    last_event_at: str | None = None
    status: str


class MonitoringResourceRow(BaseModel):
    component: str
    cpu_percent: float | None = None
    memory_mb: float | None = None
    disk_io_mb_s: float | None = None
    network_io_mb_s: float | None = None
    status: str


class MonitoringStorageRow(BaseModel):
    storage_layer: str
    status: str
    used_gb: float | None = None
    capacity_gb: float | None = None
    last_check: str | None = None
    notes: str | None = None


class MonitoringAiServiceRow(BaseModel):
    service: str
    status: str
    model: str | None = None
    requests_per_minute: int | None = None
    avg_latency_sec: float | None = None
    compute_mode: str | None = None
    last_error: str | None = None


class MonitoringAiIssue(BaseModel):
    time: str
    severity: str
    message: str


class MonitoringAiOps(BaseModel):
    llm_failures_last_hour: int | None = None
    planner_failures_last_15m: int | None = None
    execution_failures_last_15m: int | None = None
    suggestions_last_refresh_utc: str | None = None
    last_successful_ai_query_at: str | None = None


class MonitoringAiResponse(BaseModel):
    services: list[MonitoringAiServiceRow]
    recent_ai_issues: list[MonitoringAiIssue]
    ops: MonitoringAiOps = Field(default_factory=MonitoringAiOps)


class MonitoringServiceAlertItem(BaseModel):
    alert_id: str
    time: str
    severity: str
    message: str


class MonitoringServiceDetail(MonitoringServiceRow):
    recent_alerts: list[MonitoringServiceAlertItem] = Field(default_factory=list)
    recent_issues: list[MonitoringServiceAlertItem] = Field(default_factory=list)
    recent_metrics: dict[str, Any] = Field(default_factory=dict)
    heartbeat_key: str | None = None
    service_last_seen_key: str | None = None
