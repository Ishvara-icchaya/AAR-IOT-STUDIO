/** Canonical JSON `config` for `device_endpoints` by protocol (worker-ready shape). */

export type IngestProtocol = "http" | "mqtt" | "coap" | "websocket";

export const INGEST_PROTOCOLS: IngestProtocol[] = ["http", "mqtt", "coap", "websocket"];

export type RestIngressMode = "inbound_hook" | "polling";

export type HttpFields = {
  restMode: RestIngressMode;
  host: string;
  port: string;
  path: string;
  method: string;
  useTls: boolean;
  timeoutSeconds: string;
  pollingUrl: string;
  pollingIntervalSeconds: string;
  headersJson: string;
  authType: "none" | "bearer" | "header";
  authHeaderName: string;
  authHeaderValue: string;
};

export type MqttBrokerMode = "internal" | "external";

export type MqttFields = {
  brokerMode: MqttBrokerMode;
  host: string;
  port: string;
  topic: string;
  qos: string;
  username: string;
  password: string;
  clientId: string;
};

export type CoapFields = {
  adapterRole: "listener";
  host: string;
  port: string;
  path: string;
  method: string;
  timeoutSeconds: string;
  security: string;
  observe: boolean;
  pollIntervalSeconds: string;
};

export type WebSocketFields = {
  url: string;
  useTls: boolean;
  subprotocol: string;
  reconnectDelaySeconds: string;
  pingIntervalSeconds: string;
  headersJson: string;
};

/**
 * Default REST Pull example (plain HTTP GET), equivalent to:
 * `curl http://192.168.68.78:7001/api/v1/runs/<run-id>/metrics`
 * Replace host, port, path, or use “Upstream URL” for your environment.
 */
export const DEFAULT_REST_PULL_EXAMPLE_HOST = "192.168.68.78";
export const DEFAULT_REST_PULL_EXAMPLE_PORT = "7001";
export const DEFAULT_REST_PULL_EXAMPLE_PATH =
  "/api/v1/runs/b90d92eb-e7e5-4e4d-97ca-a8736946521d/metrics";

const DEFAULT_HTTP: HttpFields = {
  restMode: "polling",
  host: DEFAULT_REST_PULL_EXAMPLE_HOST,
  port: DEFAULT_REST_PULL_EXAMPLE_PORT,
  path: DEFAULT_REST_PULL_EXAMPLE_PATH,
  method: "GET",
  useTls: false,
  timeoutSeconds: "30",
  pollingUrl: "",
  pollingIntervalSeconds: "60",
  headersJson: "",
  authType: "none",
  authHeaderName: "Authorization",
  authHeaderValue: "",
};

const DEFAULT_MQTT: MqttFields = {
  brokerMode: "external",
  host: "",
  port: "1883",
  topic: "",
  qos: "0",
  username: "",
  password: "",
  clientId: "",
};

const DEFAULT_COAP: CoapFields = {
  adapterRole: "listener",
  host: "",
  port: "5683",
  path: "/telemetry",
  method: "GET",
  timeoutSeconds: "10",
  security: "none",
  observe: false,
  pollIntervalSeconds: "30",
};

const DEFAULT_WEBSOCKET: WebSocketFields = {
  url: "",
  useTls: false,
  subprotocol: "",
  reconnectDelaySeconds: "5",
  pingIntervalSeconds: "30",
  headersJson: "",
};

export function defaultFieldsForProtocol(
  p: IngestProtocol,
): HttpFields | MqttFields | CoapFields | WebSocketFields {
  switch (p) {
    case "http":
      return { ...DEFAULT_HTTP };
    case "mqtt":
      return { ...DEFAULT_MQTT };
    case "coap":
      return { ...DEFAULT_COAP };
    case "websocket":
      return { ...DEFAULT_WEBSOCKET };
  }
}

function num(s: string, fallback: number): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Map legacy `http` + `{ url }` and structured keys into HTTP fields. */
export function configToHttpFields(protocol: string, c: Record<string, unknown>): HttpFields {
  const base = { ...DEFAULT_HTTP };
  const rmRaw = typeof c.rest_mode === "string" ? c.rest_mode : typeof c.restMode === "string" ? c.restMode : "";
  const rm = rmRaw.toLowerCase();
  if (rm === "inbound_hook" || rm === "polling") base.restMode = rm;
  const urlStr = typeof c.url === "string" ? c.url : "";
  if (urlStr) {
    try {
      const u = new URL(urlStr);
      base.host = u.hostname;
      base.port = u.port || (u.protocol === "https:" ? "443" : "80");
      base.path = `${u.pathname}${u.search || ""}` || "/";
      base.useTls = u.protocol === "https:";
    } catch {
      base.host = urlStr;
    }
  }
  if (typeof c.host === "string") base.host = c.host;
  if (typeof c.port === "number") base.port = String(c.port);
  else if (typeof c.port === "string") base.port = c.port;
  if (typeof c.path === "string") base.path = c.path;
  if (typeof c.method === "string") base.method = c.method.toUpperCase();
  if (typeof c.use_tls === "boolean") base.useTls = c.use_tls;
  if (typeof c.timeout_seconds === "number") base.timeoutSeconds = String(c.timeout_seconds);
  else if (typeof c.timeout_seconds === "string") base.timeoutSeconds = c.timeout_seconds;
  if (typeof c.polling_url === "string") base.pollingUrl = c.polling_url;
  if (typeof c.polling_interval_seconds === "number")
    base.pollingIntervalSeconds = String(c.polling_interval_seconds);
  else if (typeof c.polling_interval_seconds === "string")
    base.pollingIntervalSeconds = c.polling_interval_seconds;
  if (typeof c.headers_json === "string") base.headersJson = c.headers_json;
  const at = typeof c.auth_type === "string" ? c.auth_type : "";
  if (at === "none" || at === "bearer" || at === "header") base.authType = at;
  if (typeof c.auth_header_name === "string") base.authHeaderName = c.auth_header_name;
  if (typeof c.auth_header_value === "string") base.authHeaderValue = c.auth_header_value;
  if (protocol === "https") base.useTls = true;
  if (base.restMode === "inbound_hook") {
    base.host = "";
    base.pollingUrl = "";
    base.method = typeof c.method === "string" && c.method.trim() ? c.method.toUpperCase() : "POST";
  } else if (base.restMode === "polling") {
    const hasExplicitMethod = typeof c.method === "string" && c.method.trim().length > 0;
    if (!hasExplicitMethod) {
      base.method = "GET";
    }
  }
  return base;
}

export function httpFieldsToConfig(f: HttpFields): Record<string, unknown> {
  /** REST Push: upstream POSTs to the platform — no upstream URL/host in config. */
  if (f.restMode === "inbound_hook") {
    return {
      rest_mode: "inbound_hook",
      method: "POST",
      timeout_seconds: 30,
      use_tls: true,
    };
  }

  const port = num(f.port, f.useTls ? 443 : 80);
  const scheme = f.useTls ? "https" : "http";
  let path = f.path.trim() || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  const url = `${scheme}://${f.host.trim()}${port ? `:${port}` : ""}${path}`;
  return {
    rest_mode: "polling",
    url,
    method: (f.method || "GET").toUpperCase(),
    timeout_seconds: num(f.timeoutSeconds, 30),
    host: f.host.trim(),
    port,
    path,
    use_tls: f.useTls,
    polling_url: f.pollingUrl.trim() || undefined,
    polling_interval_seconds: num(f.pollingIntervalSeconds, 60),
    headers_json: f.headersJson.trim() || undefined,
    auth_type: f.authType,
    auth_header_name: f.authType === "header" ? f.authHeaderName.trim() || undefined : undefined,
    auth_header_value:
      f.authType === "bearer" || f.authType === "header"
        ? f.authHeaderValue || undefined
        : undefined,
  };
}

export function configToMqttFields(c: Record<string, unknown>): MqttFields {
  const base = { ...DEFAULT_MQTT };
  const bm = typeof c.broker_mode === "string" ? c.broker_mode.toLowerCase() : "";
  if (bm === "internal" || bm === "external") base.brokerMode = bm;
  if (typeof c.broker_host === "string") base.host = c.broker_host;
  else if (typeof c.host === "string") base.host = c.host;
  if (typeof c.broker_port === "number") base.port = String(c.broker_port);
  else if (typeof c.broker_port === "string") base.port = c.broker_port;
  else if (typeof c.port === "number") base.port = String(c.port);
  else if (typeof c.port === "string") base.port = c.port;
  if (typeof c.topic === "string") base.topic = c.topic;
  if (typeof c.qos === "number") base.qos = String(Math.min(2, Math.max(0, c.qos)));
  else if (typeof c.qos === "string") base.qos = ["0", "1", "2"].includes(c.qos) ? c.qos : "0";
  if (typeof c.username === "string") base.username = c.username;
  if (typeof c.password === "string") base.password = c.password;
  if (typeof c.client_id === "string") base.clientId = c.client_id;
  return base;
}

export function mqttFieldsToConfig(f: MqttFields): Record<string, unknown> {
  const port = num(f.port, 1883);
  const qos = Math.min(2, Math.max(0, num(f.qos, 0)));
  const host =
    f.brokerMode === "internal" ? (f.host.trim() || "mosquitto") : f.host.trim();
  return {
    broker_mode: f.brokerMode,
    broker_host: host,
    broker_port: port,
    topic: f.topic.trim(),
    qos,
    username: f.username.trim() || undefined,
    password: f.password || undefined,
    client_id: f.clientId.trim() || undefined,
    use_tls: port === 8883,
  };
}

export function configToCoapFields(c: Record<string, unknown>): CoapFields {
  const base = { ...DEFAULT_COAP };
  if (typeof c.adapter_role === "string" && c.adapter_role === "listener") base.adapterRole = "listener";
  if (typeof c.host === "string") base.host = c.host;
  if (typeof c.port === "number") base.port = String(c.port);
  else if (typeof c.port === "string") base.port = c.port;
  if (typeof c.path === "string") base.path = c.path;
  if (typeof c.method === "string") base.method = c.method.toUpperCase();
  if (typeof c.timeout_seconds === "number") base.timeoutSeconds = String(c.timeout_seconds);
  if (typeof c.security === "string") base.security = c.security;
  if (typeof c.observe === "boolean") base.observe = c.observe;
  if (typeof c.poll_interval_seconds === "number")
    base.pollIntervalSeconds = String(c.poll_interval_seconds);
  else if (typeof c.poll_interval_seconds === "string") base.pollIntervalSeconds = c.poll_interval_seconds;
  return base;
}

export function coapFieldsToConfig(f: CoapFields): Record<string, unknown> {
  return {
    adapter_role: "listener",
    role_description: "coap_listener_adapter",
    host: f.host.trim(),
    port: num(f.port, 5683),
    path: (f.path.trim() || "/").startsWith("/") ? f.path.trim() || "/" : `/${f.path.trim()}`,
    method: (f.method || "GET").toUpperCase(),
    timeout_seconds: num(f.timeoutSeconds, 10),
    security: f.security || "none",
    observe: f.observe,
    poll_interval_seconds: num(f.pollIntervalSeconds, 30),
  };
}

export function configToWebSocketFields(c: Record<string, unknown>): WebSocketFields {
  const base = { ...DEFAULT_WEBSOCKET };
  if (typeof c.url === "string") base.url = c.url;
  if (typeof c.use_tls === "boolean") base.useTls = c.use_tls;
  if (typeof c.subprotocol === "string") base.subprotocol = c.subprotocol;
  if (typeof c.reconnect_delay_seconds === "number")
    base.reconnectDelaySeconds = String(c.reconnect_delay_seconds);
  else if (typeof c.reconnect_delay_seconds === "string")
    base.reconnectDelaySeconds = c.reconnect_delay_seconds;
  if (typeof c.ping_interval_seconds === "number")
    base.pingIntervalSeconds = String(c.ping_interval_seconds);
  else if (typeof c.ping_interval_seconds === "string")
    base.pingIntervalSeconds = c.ping_interval_seconds;
  if (typeof c.headers_json === "string") base.headersJson = c.headers_json;
  return base;
}

export function webSocketFieldsToConfig(f: WebSocketFields): Record<string, unknown> {
  return {
    url: f.url.trim(),
    use_tls: f.useTls,
    subprotocol: f.subprotocol.trim() || undefined,
    reconnect_delay_seconds: num(f.reconnectDelaySeconds, 5),
    ping_interval_seconds: num(f.pingIntervalSeconds, 30),
    headers_json: f.headersJson.trim() || undefined,
  };
}

/** Normalize API protocol string to ingest key (legacy `https` → http fields; `socket` → websocket). */
export function normalizeProtocol(p: string): IngestProtocol {
  const x = (p || "http").toLowerCase();
  if (x === "https") return "http";
  if (x === "rest") return "http";
  if (x === "file") return "http";
  if (x === "ws" || x === "wss" || x === "socket") return "websocket";
  if (INGEST_PROTOCOLS.includes(x as IngestProtocol)) return x as IngestProtocol;
  return "http";
}

export function parseConfigToFields(
  protocol: string,
  config: Record<string, unknown>,
): {
  protocol: IngestProtocol;
  http: HttpFields;
  mqtt: MqttFields;
  coap: CoapFields;
  websocket: WebSocketFields;
} {
  const np = normalizeProtocol(protocol);
  return {
    protocol: np,
    http: configToHttpFields(protocol, config),
    mqtt: configToMqttFields(config),
    coap: configToCoapFields(config),
    websocket: configToWebSocketFields(config),
  };
}

export function buildConfigFromFields(
  protocol: IngestProtocol,
  http: HttpFields,
  mqtt: MqttFields,
  coap: CoapFields,
  websocket: WebSocketFields,
): Record<string, unknown> {
  switch (protocol) {
    case "http":
      return httpFieldsToConfig(http);
    case "mqtt":
      return mqttFieldsToConfig(mqtt);
    case "coap":
      return coapFieldsToConfig(coap);
    case "websocket":
      return webSocketFieldsToConfig(websocket);
    default:
      return httpFieldsToConfig(http);
  }
}

/**
 * Re-parse stored `device_endpoints.config` and re-emit the shape the editors produce.
 * Ignores unknown or legacy top-level keys (e.g. alternate `host` vs `broker_host`) so
 * “structure must match” checks compare like-for-like with {@link buildConfigFromFields}.
 */
export function canonicalConfigFromStored(
  protocol: string,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const parsed = parseConfigToFields(protocol, config ?? {});
  return buildConfigFromFields(parsed.protocol, parsed.http, parsed.mqtt, parsed.coap, parsed.websocket);
}
