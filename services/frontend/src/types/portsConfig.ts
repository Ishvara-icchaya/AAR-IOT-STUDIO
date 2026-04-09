export type PlatformPortDTO = {
  id: string;
  service_name: string;
  protocol: string;
  host: string;
  port: number;
  enabled: boolean;
};

export type MqttIngestTenantDTO = {
  broker_mode: "internal" | "external";
  external_broker_host: string | null;
  external_broker_port: number | null;
  subscribe_topic: string | null;
  qos: number;
};

export type MqttIngestDeploymentDTO = {
  platform_broker_enabled: boolean;
  mqtt_bridge_deployed: boolean;
  listen_port: number;
  probe_host: string;
  sensor_connect_host_hint: string | null;
};

export type PlatformPortsConfigDTO = {
  ports: PlatformPortDTO[];
  default_rest_publish_host: string | null;
  default_rest_publish_port: number | null;
  default_mqtt_publish_host: string | null;
  default_mqtt_publish_port: number | null;
  mqtt_ingest: MqttIngestTenantDTO;
  mqtt_ingest_deployment: MqttIngestDeploymentDTO;
  allow_external_access: boolean;
  restrict_to_localhost: boolean;
  enable_tls: boolean;
};

export type PlatformPortUpdateItem = Omit<PlatformPortDTO, "id">;

export type PlatformPortsConfigUpdateDTO = {
  ports: PlatformPortUpdateItem[];
  default_rest_publish_host: string | null;
  default_rest_publish_port: number | null;
  default_mqtt_publish_host: string | null;
  default_mqtt_publish_port: number | null;
  mqtt_ingest: MqttIngestTenantDTO;
  allow_external_access: boolean;
  restrict_to_localhost: boolean;
  enable_tls: boolean;
};

export type PortProbeResult = {
  service_name: string;
  host: string;
  port: number;
  reachable: boolean;
  detail?: string | null;
};

export type PlatformPortsTestResponse = {
  success: boolean;
  results: PortProbeResult[];
  conflicts: string[];
  message: string;
};

export type PlatformPortsRestartResponse = {
  success: boolean;
  message: string;
};
