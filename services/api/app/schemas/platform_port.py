from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MqttIngestTenantRead(BaseModel):
    """Per-tenant MQTT telemetry ingest preferences (documentation + worker hints)."""

    broker_mode: Literal["internal", "external"] = "internal"
    external_broker_host: str | None = None
    external_broker_port: int | None = Field(default=None, ge=1, le=65535)
    subscribe_topic: str | None = Field(default=None, max_length=512)
    qos: int = Field(default=0, ge=0, le=2)


class MqttIngestDeploymentRead(BaseModel):
    """Deployment-derived MQTT ingest facts (read-only; set via API server environment)."""

    platform_broker_enabled: bool = False
    mqtt_bridge_deployed: bool = False
    listen_port: int = 1883
    probe_host: str = "127.0.0.1"
    sensor_connect_host_hint: str | None = None


class PlatformPortRead(BaseModel):
    id: str
    service_name: str
    protocol: str
    host: str
    port: int
    enabled: bool

    model_config = {"from_attributes": True}


class PlatformPortUpdateItem(BaseModel):
    service_name: str = Field(..., min_length=1, max_length=64)
    protocol: str = Field(..., min_length=1, max_length=16)
    host: str = Field(..., min_length=1, max_length=128)
    port: int = Field(..., ge=1, le=65535)
    enabled: bool


class PlatformPortsConfigRead(BaseModel):
    ports: list[PlatformPortRead]
    default_rest_publish_host: str | None
    default_rest_publish_port: int | None
    default_mqtt_publish_host: str | None
    default_mqtt_publish_port: int | None
    mqtt_ingest: MqttIngestTenantRead
    mqtt_ingest_deployment: MqttIngestDeploymentRead
    allow_external_access: bool
    restrict_to_localhost: bool
    enable_tls: bool


class PlatformPortsConfigUpdate(BaseModel):
    ports: list[PlatformPortUpdateItem]
    default_rest_publish_host: str | None = Field(None, max_length=128)
    default_rest_publish_port: int | None = Field(None, ge=1, le=65535)
    default_mqtt_publish_host: str | None = Field(None, max_length=128)
    default_mqtt_publish_port: int | None = Field(None, ge=1, le=65535)
    mqtt_ingest: MqttIngestTenantRead
    allow_external_access: bool
    restrict_to_localhost: bool
    enable_tls: bool


class PortProbeResult(BaseModel):
    service_name: str
    host: str
    port: int
    reachable: bool
    detail: str | None = None


class PlatformPortsTestResponse(BaseModel):
    success: bool
    results: list[PortProbeResult]
    conflicts: list[str]
    message: str


class PlatformPortsRestartResponse(BaseModel):
    success: bool
    message: str


def port_read_from_model(row) -> PlatformPortRead:
    return PlatformPortRead(
        id=str(row.id),
        service_name=row.service_name,
        protocol=row.protocol,
        host=row.host,
        port=row.port,
        enabled=row.enabled,
    )
