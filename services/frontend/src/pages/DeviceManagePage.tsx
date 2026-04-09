import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import {
  fetchDeviceEndpoint,
  validateDeviceEndpoint,
  type DeviceEndpointObservability,
  type DeviceEndpointRead,
} from "@/api/deviceEndpoints";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import {
  buildConfigFromFields,
  type CoapFields,
  type HttpFields,
  INGEST_PROTOCOLS,
  type IngestProtocol,
  type MqttFields,
  normalizeProtocol,
  parseConfigToFields,
  type WebSocketFields,
} from "@/lib/deviceEndpointConfig";
import {
  ENDPOINT_ACTIVATION_STATUSES,
  activationStatusStyle,
  formatActivationLabel,
} from "@/lib/endpointActivation";
import {
  monitoringIngressLinks,
  monitoringOverviewHref,
  monitoringServiceHref,
} from "@/lib/monitoringIngressLinks";

type DeviceRow = {
  id: string;
  site_id: string;
  name: string;
  is_active: boolean;
  polling_enabled: boolean;
  endpoint: {
    id: string;
    protocol: string;
    config: Record<string, unknown>;
    polling_interval_seconds: number;
    is_active: boolean;
    activation_status?: string;
    first_payload_at?: string | null;
    last_payload_at?: string | null;
    last_error?: string | null;
    validation_status?: string | null;
  } | null;
};

type SiteRow = { id: string; name: string };

type RawListItem = {
  id: string;
  ingested_at: string;
  size_bytes: number | null;
  protocol_source: string | null;
};

type RawPreview = {
  raw_object_id: string;
  encoding: "utf8" | "base64";
  text: string | null;
  base64: string | null;
  truncated: boolean;
  returned_bytes: number;
};

function tryPrettyJson(s: string): string {
  const t = s.trim();
  if (!t) return s;
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      /* keep raw */
    }
  }
  return s;
}

/** MQTT/ingest preview: show JSON text; handle missing `text` in API JSON; optional base64→UTF-8. */
function formatIngestPreviewBody(p: RawPreview | null): string {
  if (!p) return "";
  if (p.encoding === "utf8") {
    return tryPrettyJson(p.text ?? "");
  }
  if (p.encoding === "base64" && p.base64) {
    try {
      const bin = atob(p.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dec = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return tryPrettyJson(dec);
    } catch {
      return `[base64 ${p.returned_bytes} bytes]\n${p.base64.slice(0, 4000)}${p.base64.length > 4000 ? "…" : ""}`;
    }
  }
  return "";
}

/** Avoid blank preview while a new raw id is loading (silent poll) or blocking fetch in flight. */
function computePreviewPreText(
  blocking: boolean,
  meta: RawListItem | null,
  preview: RawPreview | null,
): string {
  if (!meta) return "";
  if (blocking) return "…";
  if (!preview || String(preview.raw_object_id) !== String(meta.id)) return "…";
  return formatIngestPreviewBody(preview);
}

function formatOptionalTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function protocolLabel(p: string) {
  const n = normalizeProtocol(p);
  if (n === "http") return "HTTP / REST";
  if (n === "websocket") return "WebSocket";
  return n.toUpperCase();
}

export function DeviceManagePage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<DeviceRow | null>(null);

  const [protocol, setProtocol] = useState<IngestProtocol>("http");
  const [httpF, setHttpF] = useState<HttpFields>(() => parseConfigToFields("http", {}).http);
  const [mqttF, setMqttF] = useState<MqttFields>(() => parseConfigToFields("mqtt", {}).mqtt);
  const [coapF, setCoapF] = useState<CoapFields>(() => parseConfigToFields("coap", {}).coap);
  const [wsF, setWsF] = useState<WebSocketFields>(() => parseConfigToFields("websocket", {}).websocket);
  const [activationFilter, setActivationFilter] = useState<string>("");

  const [pollRealtime, setPollRealtime] = useState(false);
  const [pollIntervalSec, setPollIntervalSec] = useState(60);

  const [payloadMeta, setPayloadMeta] = useState<RawListItem | null>(null);
  const [payloadPreview, setPayloadPreview] = useState<RawPreview | null>(null);
  const [payloadErr, setPayloadErr] = useState<string | null>(null);
  const [payloadBlocking, setPayloadBlocking] = useState(false);
  const [payloadHydrated, setPayloadHydrated] = useState(false);
  const [rawListTotal, setRawListTotal] = useState<number | null>(null);

  const [observability, setObservability] = useState<DeviceEndpointObservability | null>(null);
  const [savedEndpoint, setSavedEndpoint] = useState<DeviceEndpointRead | null>(null);
  const [validating, setValidating] = useState(false);

  const loadEndpointFields = useCallback(async (deviceId: string) => {
    try {
      const pack = await fetchDeviceEndpoint(deviceId);
      if (!pack) {
        setObservability(null);
        setSavedEndpoint(null);
        return;
      }
      setObservability(pack.observability ?? null);
      if (pack.defined && pack.endpoint) {
        setSavedEndpoint(pack.endpoint);
        const p = pack.endpoint.protocol;
        const parsed = parseConfigToFields(p, pack.endpoint.config ?? {});
        setProtocol(parsed.protocol);
        setHttpF(parsed.http);
        setMqttF(parsed.mqtt);
        setCoapF(parsed.coap);
        setWsF(parsed.websocket);
        const iv = pack.endpoint.polling_interval_seconds;
        setPollRealtime(iv === 0);
        setPollIntervalSec(iv === 0 ? 60 : Math.max(5, iv));
      } else {
        setSavedEndpoint(null);
        setProtocol("http");
        setHttpF(parseConfigToFields("http", {}).http);
        setMqttF(parseConfigToFields("mqtt", {}).mqtt);
        setCoapF(parseConfigToFields("coap", {}).coap);
        setWsF(parseConfigToFields("websocket", {}).websocket);
        setPollRealtime(false);
        setPollIntervalSec(60);
      }
    } catch {
      setObservability(null);
      setSavedEndpoint(null);
      setProtocol("http");
      setPollRealtime(false);
      setPollIntervalSec(60);
    }
  }, []);

  const refresh = useCallback(async (): Promise<DeviceRow[]> => {
    setLoading(true);
    setErr(null);
    try {
      const af = activationFilter.trim();
      const devPath = af
        ? `/devices?endpoint_activation_status=${encodeURIComponent(af)}`
        : "/devices";
      const [devRes, siteList] = await Promise.all([
        apiFetch<{ items: DeviceRow[] }>(devPath),
        apiFetch<SiteRow[]>("/administration/sites").catch(() => [] as SiteRow[]),
      ]);
      const items = devRes?.items ?? [];
      setDevices(items);
      const map: Record<string, string> = {};
      for (const s of siteList ?? []) map[s.id] = s.name;
      setSitesById(map);
      return items;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load devices");
      return [];
    } finally {
      setLoading(false);
    }
  }, [activationFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!editingDevice) return;
    void loadEndpointFields(editingDevice.id);
  }, [editingDevice, loadEndpointFields]);

  const previewRefreshMs =
    editingDevice && (pollRealtime || savedEndpoint?.polling_interval_seconds === 0) ? 2000 : 5000;

  const runPayloadFetch = useCallback(async (deviceId: string, mode: "initial" | "silent" | "manual") => {
    const showBlocking = mode !== "silent";
    if (showBlocking) setPayloadBlocking(true);
    if (mode === "initial") {
      setPayloadHydrated(false);
      setPayloadMeta(null);
      setPayloadPreview(null);
      setRawListTotal(null);
    }
    setPayloadErr(null);
    try {
      const [list, epPack] = await Promise.all([
        apiFetch<{ items: RawListItem[]; total?: number }>(
          `/raw-data-objects?device_id=${encodeURIComponent(deviceId)}&limit=1&offset=0`,
        ),
        fetchDeviceEndpoint(deviceId).catch(() => null),
      ]);
      if (epPack?.observability) setObservability(epPack.observability);
      const items = Array.isArray(list?.items) ? list.items : [];
      const total = typeof list?.total === "number" ? list.total : items.length ? items.length : 0;
      setRawListTotal(total);
      const first = items[0];
      if (!first) {
        setPayloadMeta(null);
        setPayloadPreview(null);
        return;
      }
      setPayloadMeta(first);
      setPayloadPreview((p) =>
        p && String(p.raw_object_id) === String(first.id) ? p : null,
      );
      const prev = await apiFetch<RawPreview>(
        `/raw-data-objects/${encodeURIComponent(first.id)}/preview?max_bytes=49152`,
      );
      setPayloadPreview(prev ?? null);
    } catch (e) {
      if (mode === "silent") return;
      const msg = e instanceof Error ? e.message : "Failed to load ingested payload";
      setPayloadErr(msg);
      setPayloadPreview(null);
      setPayloadMeta(null);
      setRawListTotal(null);
    } finally {
      if (showBlocking) setPayloadBlocking(false);
      setPayloadHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!editingDevice) {
      setPayloadMeta(null);
      setPayloadPreview(null);
      setPayloadErr(null);
      setPayloadBlocking(false);
      setPayloadHydrated(false);
      setRawListTotal(null);
      return;
    }
    void runPayloadFetch(editingDevice.id, "initial");
  }, [editingDevice?.id, runPayloadFetch]);

  useEffect(() => {
    if (!editingDevice || !payloadHydrated) return;
    const deviceId = editingDevice.id;
    const id = window.setInterval(() => void runPayloadFetch(deviceId, "silent"), previewRefreshMs);
    return () => window.clearInterval(id);
  }, [editingDevice?.id, previewRefreshMs, runPayloadFetch, payloadHydrated]);

  function startEdit(d: DeviceRow) {
    setEditingDevice(d);
    setErr(null);
  }

  function cancelEdit() {
    setEditingDevice(null);
    setObservability(null);
    setSavedEndpoint(null);
    window.requestAnimationFrame(() => {
      document.getElementById("registered-devices-table")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  async function runValidation() {
    if (!editingDevice) return;
    const deviceId = editingDevice.id;
    setValidating(true);
    setErr(null);
    try {
      const res = await validateDeviceEndpoint(deviceId);
      if (res) {
        setObservability(res.observability);
        setSavedEndpoint(res.endpoint);
      }
      await runPayloadFetch(deviceId, "manual");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  const builtConfigForCompare = useMemo(
    () => buildConfigFromFields(protocol, httpF, mqttF, coapF, wsF),
    [protocol, httpF, mqttF, coapF, wsF],
  );
  const pollingSecondsForSave = pollRealtime ? 0 : pollIntervalSec;

  const hasUnsavedChanges = useMemo(() => {
    if (!savedEndpoint) return true;
    if (savedEndpoint.protocol !== protocol) return true;
    if (savedEndpoint.polling_interval_seconds !== pollingSecondsForSave) return true;
    return (
      JSON.stringify(savedEndpoint.config ?? {}) !== JSON.stringify(builtConfigForCompare)
    );
  }, [savedEndpoint, protocol, pollingSecondsForSave, builtConfigForCompare]);

  /** After first save, API requires a successful validation before persisting again; warning = connectivity OK, no payload yet; ok = operational. */
  const validationAllowsSave = useMemo(() => {
    if (!savedEndpoint) return true;
    const v = savedEndpoint.validation_status;
    return v === "warning" || v === "ok";
  }, [savedEndpoint]);

  const canSaveConfiguration =
    !submitting && hasUnsavedChanges && validationAllowsSave;

  function validateEndpoint(): string | null {
    if (protocol === "http") {
      if (httpF.restMode === "polling") {
        if (!httpF.pollingUrl.trim()) return "Polling upstream URL is required for polling mode.";
      } else if (!httpF.host.trim()) return "HTTP host is required for inbound hook configuration.";
    }
    if (protocol === "mqtt") {
      if (mqttF.brokerMode === "external" && !mqttF.host.trim()) {
        return "MQTT broker host is required when using an external broker.";
      }
      if (!mqttF.topic.trim()) return "MQTT topic is required.";
    }
    if (protocol === "coap") {
      if (!coapF.host.trim()) return "CoAP host is required.";
    }
    if (protocol === "websocket") {
      if (!wsF.url.trim()) return "WebSocket URL is required.";
    }
    if (!pollRealtime && pollIntervalSec < 5) return "Polling interval must be at least 5 seconds (or use Real time).";
    return null;
  }

  async function saveEndpoint(e: FormEvent) {
    e.preventDefault();
    if (!editingDevice) return;
    const v = validateEndpoint();
    if (v) {
      setErr(v);
      return;
    }
    if (!canSaveConfiguration) {
      setErr("Run validation first; save is enabled when validation is warning or ok (not failed).");
      return;
    }
    setSubmitting(true);
    setErr(null);
    const config = builtConfigForCompare;
    const polling_interval_seconds = pollingSecondsForSave;
    try {
      await apiFetch("/device-endpoints", {
        method: "POST",
        json: {
          device_id: editingDevice.id,
          protocol,
          config,
          polling_interval_seconds,
          is_active: true,
        },
      });
      await refresh();
      cancelEdit();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Validate endpoint failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell title="Manage Devices">
      <div style={stack}>
        {err ? <PageStatus variant="error">{err}</PageStatus> : null}

        {!editingDevice ? (
          <nav style={breadcrumbNav} aria-label="Manage devices">
            <span style={breadcrumbCurrent}>All registered devices</span>
            <span style={breadcrumbMuted}> — table below</span>
          </nav>
        ) : null}

        {editingDevice && (
          <section style={{ ...section, padding: "0.85rem 1rem", minWidth: 0 }}>
            <nav style={breadcrumbNav} aria-label="Manage devices">
              <button type="button" style={breadcrumbBtn} onClick={cancelEdit}>
                ← All devices (table)
              </button>
              <span style={breadcrumbSep} aria-hidden>
                /
              </span>
              <span style={breadcrumbCurrent}>Edit · {editingDevice.name}</span>
            </nav>
            <h2 style={{ ...h2, fontSize: "0.95rem", marginTop: "0.5rem" }}>Edit device</h2>
            <p style={{ ...muted, fontSize: "0.8rem" }}>
              <strong>{editingDevice.name}</strong> · {sitesById[editingDevice.site_id] ?? editingDevice.site_id.slice(0, 8) + "…"} · Status:{" "}
              <strong>{editingDevice.is_active ? "Active" : "Inactive"}</strong>
            </p>

            <div style={editLayoutRoot} role="region" aria-label="Endpoint editor layout">
              <div style={editRow1}>
                <div style={editPanel}>
                  <div style={editPanelTitle}>Endpoint configuration</div>
                <form id="device-endpoint-form" onSubmit={saveEndpoint} style={{ minWidth: 0 }}>
                <div style={fieldGrid23}>
                  <label style={lblSm}>
                    Protocol
                    <select
                      value={protocol}
                      onChange={(e) => setProtocol(e.target.value as IngestProtocol)}
                      style={inpSm}
                      required
                    >
                      {INGEST_PROTOCOLS.map((opt) => (
                        <option key={opt} value={opt}>
                          {protocolLabel(opt)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lblSm}>
                    Polling
                    <select
                      value={pollRealtime ? "rt" : "iv"}
                      onChange={(e) => setPollRealtime(e.target.value === "rt")}
                      style={inpSm}
                    >
                      <option value="rt">Real time (0s)</option>
                      <option value="iv">Interval</option>
                    </select>
                  </label>
                  <label style={lblSm}>
                    Interval (sec)
                    <input
                      type="number"
                      min={5}
                      max={86400}
                      disabled={pollRealtime}
                      value={pollIntervalSec}
                      onChange={(e) => setPollIntervalSec(Number(e.target.value))}
                      style={{ ...inpSm, opacity: pollRealtime ? 0.5 : 1 }}
                    />
                  </label>
                </div>

                {protocol === "http" && (
                  <div style={fieldGrid23}>
                    <label style={lblSm}>
                      REST mode
                      <select
                        value={httpF.restMode}
                        onChange={(e) =>
                          setHttpF({
                            ...httpF,
                            restMode: e.target.value as "inbound_hook" | "polling",
                          })
                        }
                        style={inpSm}
                      >
                        <option value="inbound_hook">Inbound hook (POST/PUT to platform /ingest/raw)</option>
                        <option value="polling">Outbound polling (upstream REST)</option>
                      </select>
                    </label>
                    {httpF.restMode === "inbound_hook" ? (
                      <p style={{ ...muted, gridColumn: "1 / -1", fontSize: "0.75rem", margin: 0 }}>
                        Platform canonical path: multipart <code>POST /api/v1/ingest/raw</code> with JWT auth (same MinIO +
                        Postgres + Kafka flow as other ingress modes).
                      </p>
                    ) : null}
                    {httpF.restMode === "polling" ? (
                      <label style={{ ...lblSm, gridColumn: "1 / -1" }}>
                        Upstream polling URL
                        <input
                          value={httpF.pollingUrl}
                          onChange={(e) => setHttpF({ ...httpF, pollingUrl: e.target.value })}
                          style={inpSm}
                          placeholder="https://vendor.example/api/stream"
                        />
                      </label>
                    ) : null}
                    {httpF.restMode === "polling" ? (
                      <label style={lblSm}>
                        Poll interval (sec)
                        <input
                          type="number"
                          min={5}
                          value={httpF.pollingIntervalSeconds}
                          onChange={(e) => setHttpF({ ...httpF, pollingIntervalSeconds: e.target.value })}
                          style={inpSm}
                        />
                      </label>
                    ) : null}
                    <label style={lblSm}>
                      Host
                      <input value={httpF.host} onChange={(e) => setHttpF({ ...httpF, host: e.target.value })} style={inpSm} />
                    </label>
                    <label style={lblSm}>
                      Port
                      <input value={httpF.port} onChange={(e) => setHttpF({ ...httpF, port: e.target.value })} style={inpSm} />
                    </label>
                    <label style={lblSm}>
                      Path
                      <input value={httpF.path} onChange={(e) => setHttpF({ ...httpF, path: e.target.value })} style={inpSm} />
                    </label>
                    <label style={lblSm}>
                      Method
                      <select
                        value={httpF.method}
                        onChange={(e) => setHttpF({ ...httpF, method: e.target.value })}
                        style={inpSm}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      TLS
                      <select
                        value={httpF.useTls ? "y" : "n"}
                        onChange={(e) => setHttpF({ ...httpF, useTls: e.target.value === "y" })}
                        style={inpSm}
                      >
                        <option value="y">Yes (HTTPS)</option>
                        <option value="n">No (HTTP)</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      Timeout (s)
                      <input
                        value={httpF.timeoutSeconds}
                        onChange={(e) => setHttpF({ ...httpF, timeoutSeconds: e.target.value })}
                        style={inpSm}
                      />
                    </label>
                    <label style={{ ...lblSm, gridColumn: "1 / -1" }}>
                      Extra headers (JSON object, optional)
                      <textarea
                        value={httpF.headersJson}
                        onChange={(e) => setHttpF({ ...httpF, headersJson: e.target.value })}
                        style={{ ...inpSm, minHeight: "4rem", fontFamily: "monospace", fontSize: "0.8rem" }}
                        placeholder='{"X-Custom":"value"}'
                      />
                    </label>
                    <label style={lblSm}>
                      Auth
                      <select
                        value={httpF.authType}
                        onChange={(e) =>
                          setHttpF({ ...httpF, authType: e.target.value as HttpFields["authType"] })
                        }
                        style={inpSm}
                      >
                        <option value="none">None</option>
                        <option value="bearer">Bearer token (Authorization)</option>
                        <option value="header">Custom header</option>
                      </select>
                    </label>
                    {httpF.authType === "header" ? (
                      <label style={lblSm}>
                        Header name
                        <input
                          value={httpF.authHeaderName}
                          onChange={(e) => setHttpF({ ...httpF, authHeaderName: e.target.value })}
                          style={inpSm}
                        />
                      </label>
                    ) : null}
                    {httpF.authType !== "none" ? (
                      <label style={{ ...lblSm, gridColumn: httpF.authType === "header" ? "1 / -1" : undefined }}>
                        Secret / token
                        <input
                          type="password"
                          value={httpF.authHeaderValue}
                          onChange={(e) => setHttpF({ ...httpF, authHeaderValue: e.target.value })}
                          style={inpSm}
                          autoComplete="off"
                        />
                      </label>
                    ) : null}
                  </div>
                )}

                {protocol === "mqtt" && (
                  <div style={fieldGrid23}>
                    <label style={lblSm}>
                      Broker mode
                      <select
                        value={mqttF.brokerMode}
                        onChange={(e) =>
                          setMqttF({ ...mqttF, brokerMode: e.target.value as "internal" | "external" })
                        }
                        style={inpSm}
                      >
                        <option value="internal">Internal (platform Mosquitto)</option>
                        <option value="external">External broker</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      Broker host
                      <input
                        value={mqttF.host}
                        onChange={(e) => setMqttF({ ...mqttF, host: e.target.value })}
                        style={inpSm}
                        placeholder={
                          mqttF.brokerMode === "internal"
                            ? "mosquitto (default if empty)"
                            : "e.g. 192.168.x.x"
                        }
                      />
                    </label>
                    <label style={lblSm}>
                      Broker port
                      <input value={mqttF.port} onChange={(e) => setMqttF({ ...mqttF, port: e.target.value })} style={inpSm} />
                    </label>
                    <label style={lblSm}>
                      Topic
                      <input value={mqttF.topic} onChange={(e) => setMqttF({ ...mqttF, topic: e.target.value })} style={inpSm} />
                    </label>
                    <p style={{ ...muted, gridColumn: "1 / -1", fontSize: "0.72rem", margin: 0 }}>
                      Use the same topic filter your sensors publish to (wildcards like <code>devices/+/telemetry</code> are
                      supported). After you validate, the bridge picks this up from the DB within ~90s (or restart{" "}
                      <code>worker-mqtt-bridge</code>).
                    </p>
                    <label style={lblSm}>
                      QoS
                      <select
                        value={mqttF.qos}
                        onChange={(e) => setMqttF({ ...mqttF, qos: e.target.value })}
                        style={inpSm}
                      >
                        <option value="0">0</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      Username
                      <input
                        value={mqttF.username}
                        onChange={(e) => setMqttF({ ...mqttF, username: e.target.value })}
                        style={inpSm}
                        autoComplete="off"
                      />
                    </label>
                    <label style={lblSm}>
                      Password
                      <input
                        type="password"
                        value={mqttF.password}
                        onChange={(e) => setMqttF({ ...mqttF, password: e.target.value })}
                        style={inpSm}
                        autoComplete="off"
                      />
                    </label>
                    <label style={lblSm}>
                      Client ID
                      <input value={mqttF.clientId} onChange={(e) => setMqttF({ ...mqttF, clientId: e.target.value })} style={inpSm} />
                    </label>
                  </div>
                )}

                {protocol === "coap" && (
                  <div style={fieldGrid23}>
                    <p style={{ ...muted, gridColumn: "1 / -1", fontSize: "0.75rem", margin: 0 }}>
                      CoAP is modeled as a <strong>listener/adapter</strong> (not a broker). Payloads must be normalized and
                      written through the canonical raw ingest path when the adapter is deployed.
                    </p>
                    <label style={lblSm}>
                      Host
                      <input value={coapF.host} onChange={(e) => setCoapF({ ...coapF, host: e.target.value })} style={inpSm} />
                    </label>
                    <label style={lblSm}>
                      Port
                      <input value={coapF.port} onChange={(e) => setCoapF({ ...coapF, port: e.target.value })} style={inpSm} />
                    </label>
                    <label style={lblSm}>
                      Path
                      <input value={coapF.path} onChange={(e) => setCoapF({ ...coapF, path: e.target.value })} style={inpSm} />
                    </label>
                    <label style={lblSm}>
                      Method
                      <select
                        value={coapF.method}
                        onChange={(e) => setCoapF({ ...coapF, method: e.target.value })}
                        style={inpSm}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      Security
                      <select
                        value={coapF.security}
                        onChange={(e) => setCoapF({ ...coapF, security: e.target.value })}
                        style={inpSm}
                      >
                        <option value="none">None</option>
                        <option value="dtls">DTLS</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      Timeout (s)
                      <input
                        value={coapF.timeoutSeconds}
                        onChange={(e) => setCoapF({ ...coapF, timeoutSeconds: e.target.value })}
                        style={inpSm}
                      />
                    </label>
                    <label style={lblSm}>
                      Observe (CoAP observe)
                      <select
                        value={coapF.observe ? "y" : "n"}
                        onChange={(e) => setCoapF({ ...coapF, observe: e.target.value === "y" })}
                        style={inpSm}
                      >
                        <option value="n">No</option>
                        <option value="y">Yes</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      Poll interval (sec)
                      <input
                        type="number"
                        min={5}
                        value={coapF.pollIntervalSeconds}
                        onChange={(e) => setCoapF({ ...coapF, pollIntervalSeconds: e.target.value })}
                        style={inpSm}
                      />
                    </label>
                  </div>
                )}

                {protocol === "websocket" && (
                  <div style={fieldGrid23}>
                    <p style={{ ...muted, gridColumn: "1 / -1", fontSize: "0.75rem", margin: 0 }}>
                      WebSocket ingest is a <strong>platform listener</strong>; configuration here is consumed by the ingest
                      adapter (same canonical archive + Kafka path as REST/MQTT).
                    </p>
                    <label style={{ ...lblSm, gridColumn: "1 / -1" }}>
                      WebSocket URL
                      <input
                        value={wsF.url}
                        onChange={(e) => setWsF({ ...wsF, url: e.target.value })}
                        style={inpSm}
                        placeholder="ws://host:8001/stream or wss://…"
                      />
                    </label>
                    <label style={lblSm}>
                      TLS (wss)
                      <select
                        value={wsF.useTls ? "y" : "n"}
                        onChange={(e) => setWsF({ ...wsF, useTls: e.target.value === "y" })}
                        style={inpSm}
                      >
                        <option value="n">ws</option>
                        <option value="y">wss</option>
                      </select>
                    </label>
                    <label style={lblSm}>
                      Subprotocol
                      <input
                        value={wsF.subprotocol}
                        onChange={(e) => setWsF({ ...wsF, subprotocol: e.target.value })}
                        style={inpSm}
                      />
                    </label>
                    <label style={lblSm}>
                      Reconnect delay (s)
                      <input
                        type="number"
                        min={1}
                        value={wsF.reconnectDelaySeconds}
                        onChange={(e) => setWsF({ ...wsF, reconnectDelaySeconds: e.target.value })}
                        style={inpSm}
                      />
                    </label>
                    <label style={lblSm}>
                      Ping interval (s)
                      <input
                        type="number"
                        min={0}
                        value={wsF.pingIntervalSeconds}
                        onChange={(e) => setWsF({ ...wsF, pingIntervalSeconds: e.target.value })}
                        style={inpSm}
                      />
                    </label>
                    <label style={{ ...lblSm, gridColumn: "1 / -1" }}>
                      Connection headers (JSON, optional)
                      <textarea
                        value={wsF.headersJson}
                        onChange={(e) => setWsF({ ...wsF, headersJson: e.target.value })}
                        style={{ ...inpSm, minHeight: "3.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}
                      />
                    </label>
                  </div>
                )}

                <div style={{ ...btnRow, marginTop: "0.65rem" }}>
                  <button
                    type="button"
                    style={secBtnSm}
                    disabled={validating || !savedEndpoint || submitting}
                    title={
                      savedEndpoint
                        ? "Checks broker/URL connectivity, payload receipt in Postgres, refreshes bridge observability, and reloads Latest archived raw + preview."
                        : "Save the configuration once, then run validation."
                    }
                    onClick={() => void runValidation()}
                  >
                    {validating ? "Validating…" : "Run validation"}
                  </button>
                  <button type="submit" style={btnSm} disabled={!canSaveConfiguration || submitting}>
                    {submitting ? "Saving…" : "Save configuration"}
                  </button>
                  <button type="button" style={secBtnSm} onClick={cancelEdit} disabled={submitting}>
                    Cancel
                  </button>
                </div>
                {!canSaveConfiguration && hasUnsavedChanges && savedEndpoint ? (
                  <p style={{ ...muted, fontSize: "0.72rem", margin: "0.35rem 0 0" }}>
                    Run validation to enable save (status must be <strong>warning</strong> or <strong>ok</strong>, not failed).
                  </p>
                ) : null}
                {!hasUnsavedChanges && savedEndpoint ? (
                  <p style={{ ...muted, fontSize: "0.72rem", margin: "0.35rem 0 0" }}>
                    No changes to save — edit fields or use <strong>Cancel</strong> to return to the device table.
                  </p>
                ) : null}
              </form>
                </div>
                <div style={{ ...editPanel, ...payloadCell }}>
                  <div style={editPanelTitle}>Ingest observability</div>
                  <div style={payloadHeaderRow}>
                    <div style={payloadTitle}>Latest archived raw</div>
                    <button
                      type="button"
                      style={payloadBlocking ? { ...refreshBtn, opacity: 0.5, cursor: "not-allowed" } : refreshBtn}
                      disabled={payloadBlocking || !editingDevice}
                      onClick={() => editingDevice && void runPayloadFetch(editingDevice.id, "manual")}
                    >
                      Refresh preview
                    </button>
                  </div>
                  <p style={payloadHint}>
                    Most recent <code>raw_data_objects</code> row for this device (same MinIO archive as MQTT bridge /
                    REST). <strong>Run validation</strong> reloads this list and preview after connectivity checks.
                    Auto-refresh ~{previewRefreshMs / 1000}s.
                  </p>
                  {payloadBlocking ? <p style={payloadLoadingLine}>Loading ingested payload…</p> : null}
                  {payloadErr ? (
                    <p style={{ color: "var(--page-status-error-fg)", fontSize: "0.78rem" }}>{payloadErr}</p>
                  ) : null}
                  {!payloadBlocking && !payloadMeta && !payloadErr ? (
                    <div style={{ marginTop: "0.35rem" }}>
                      <p style={payloadEmpty}>
                        No archived raw payloads for this device (total matching API: {rawListTotal ?? "—"}).
                      </p>
                      <p style={{ ...payloadHint, marginTop: "0.4rem" }}>
                        For <strong>MQTT</strong>, <strong>WebSocket</strong>, and <strong>REST polling</strong>, ingest is
                        tied to this saved endpoint — payload does not need to carry the AAR device UUID. If you use{" "}
                        <strong>CoAP</strong> without endpoint binding, the payload must still identify a registered device
                        (UUID or unique name + site). Optional upstream <code>device_id</code> / <code>site_id</code> fields
                        are copied into <code>ingest_metadata</code> when present.
                      </p>
                      <p style={{ ...payloadHint, marginTop: "0.25rem" }}>
                        <Link to="/devices/raw" style={{ color: "var(--color-accent)" }}>
                          Raw Data
                        </Link>{" "}
                        — search archives by device or site name.
                      </p>
                    </div>
                  ) : null}
                  {payloadMeta ? (
                    <>
                      <table style={kvTable} aria-label="Latest raw object summary">
                        <tbody>
                          <tr>
                            <th scope="row" style={kvTh}>
                              Ingested at
                            </th>
                            <td style={kvTd}>{new Date(payloadMeta.ingested_at).toLocaleString()}</td>
                          </tr>
                          <tr>
                            <th scope="row" style={kvTh}>
                              Size (bytes)
                            </th>
                            <td style={kvTd}>{payloadMeta.size_bytes ?? "—"}</td>
                          </tr>
                          <tr>
                            <th scope="row" style={kvTh}>
                              Protocol source
                            </th>
                            <td style={kvTd}>{payloadMeta.protocol_source ?? "—"}</td>
                          </tr>
                        </tbody>
                      </table>
                      <div style={payloadPreLabel}>Payload body (archived bytes)</div>
                      <pre style={payloadPre}>
                        {computePreviewPreText(payloadBlocking, payloadMeta, payloadPreview)}
                      </pre>
                    </>
                  ) : null}
                  {payloadPreview?.truncated ? (
                    <p style={payloadHint}>Preview truncated — open Raw Data for full object.</p>
                  ) : null}
                </div>
              </div>

              <div style={editRow2}>
                <div style={editPanel}>
                  <div style={editPanelTitle}>Endpoint runtime state</div>
                  <table style={kvTable} aria-label="Endpoint runtime state">
                    <tbody>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Configuration saved
                        </th>
                        <td style={kvTd}>
                          {savedEndpoint
                            ? `Yes · updated ${new Date(savedEndpoint.updated_at).toLocaleString()}`
                            : "Not saved yet"}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Activation status
                        </th>
                        <td style={kvTd}>
                          {savedEndpoint?.activation_status ? (
                            <span style={activationStatusStyle(savedEndpoint.activation_status)}>
                              {formatActivationLabel(savedEndpoint.activation_status)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Validation status
                        </th>
                        <td style={kvTd}>
                          {savedEndpoint?.validation_status ? (
                            <span
                              style={{
                                color:
                                  savedEndpoint.validation_status === "ok"
                                    ? "var(--color-success, #2e7d32)"
                                    : savedEndpoint.validation_status === "warning"
                                      ? "var(--color-warning, #b8860b)"
                                      : "var(--page-status-error-fg, #c62828)",
                                fontWeight: 600,
                              }}
                            >
                              {savedEndpoint.validation_status}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Last raw ingested (DB)
                        </th>
                        <td style={kvTd}>
                          {observability?.last_raw_ingested_at
                            ? formatOptionalTs(observability.last_raw_ingested_at)
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          First payload
                        </th>
                        <td style={kvTd}>{formatOptionalTs(savedEndpoint?.first_payload_at)}</td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Last payload
                        </th>
                        <td style={kvTd}>{formatOptionalTs(savedEndpoint?.last_payload_at)}</td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Last validated
                        </th>
                        <td style={kvTd}>{formatOptionalTs(savedEndpoint?.last_verified_at)}</td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Last error
                        </th>
                        <td style={{ ...kvTd, color: "var(--page-status-error-fg, #c62828)" }}>
                          {savedEndpoint?.last_error?.trim()
                            ? savedEndpoint.last_error
                            : savedEndpoint?.validation_status === "failed" && savedEndpoint?.validation_detail
                              ? savedEndpoint.validation_detail
                              : "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {savedEndpoint?.validation_detail ? (
                    <pre style={validationPre}>{savedEndpoint.validation_detail}</pre>
                  ) : (
                    <p style={{ ...muted, fontSize: "0.72rem", margin: "0.35rem 0 0" }}>
                      Use <strong>Run validation</strong> above after the first save to refresh connectivity and payload-receipt checks.
                    </p>
                  )}
                </div>

                <div style={editPanel}>
                  <div style={editPanelTitle}>MQTT (platform bridge)</div>
                  {normalizeProtocol(savedEndpoint?.protocol ?? protocol) === "mqtt" ? (
                    observability ? (
                      <MqttBridgeObservabilityTable o={observability} />
                    ) : (
                      <p style={{ ...muted, fontSize: "0.72rem", margin: 0 }}>
                        Save the endpoint and run <strong>Run validation</strong> (or refresh the page) to load bridge
                        subscription snapshot from Redis.
                      </p>
                    )
                  ) : (
                    <p style={{ ...muted, fontSize: "0.72rem", margin: 0 }}>
                      Shown when the saved protocol is MQTT. Subscription state comes from{" "}
                      <code>worker-mqtt-bridge</code> via Redis.
                    </p>
                  )}
                  <p
                    style={{
                      ...payloadHint,
                      marginTop: "0.55rem",
                      paddingTop: "0.45rem",
                      borderTop: "1px solid var(--color-border-subtle, #333)",
                    }}
                  >
                    <strong>Monitor MQTT ingest (terminal on the host)</strong>
                    <br />
                    <code>mosquitto</code> and <code>worker-mqtt-bridge</code> are part of the default Compose stack (
                    <code>docker compose up -d</code>). If <code>logs -f</code> is empty, confirm the containers are up (
                    <code>docker compose ps</code>).
                    <br />
                    <code style={{ fontSize: "0.68rem", wordBreak: "break-all", display: "block", marginTop: "0.2rem" }}>
                      docker compose logs -f worker-mqtt-bridge
                    </code>
                    <code style={{ fontSize: "0.68rem", wordBreak: "break-all", display: "block", marginTop: "0.2rem" }}>
                      docker compose logs -f mosquitto
                    </code>
                    Logs should show <code>ingest connected broker_host=… broker_port=…</code>, then{" "}
                    <code>subscribed topic=… sources=[endpoint_id, device_id, …]</code> from your saved Manage Devices
                    config (not a single global broker). Optional <code>MQTT_TOPICS</code> still uses{" "}
                    <code>MQTT_BROKER_HOST</code> in Compose. More detail: <code>LOG_LEVEL=DEBUG</code> on the worker.
                    Compose maps Mosquitto to host port <code>18883</code> by default (container 1883). Publish from the
                    host with <code>-p 18883</code>, or set <code>MQTT_BROKER_PUBLISH_PORT</code> in <code>.env</code>.
                  </p>
                </div>

                <div style={editPanel}>
                  <table style={kvTable} aria-label="Platform monitoring links">
                    <caption
                      style={{
                        captionSide: "top",
                        textAlign: "left",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                        paddingBottom: "0.35rem",
                        color: "var(--color-text)",
                      }}
                    >
                      Platform monitoring
                    </caption>
                    <tbody>
                      <tr>
                        <td colSpan={2} style={{ ...kvTd, borderBottom: "none", paddingBottom: "0.35rem" }}>
                          <p style={{ ...muted, fontSize: "0.72rem", margin: 0 }}>
                            Workers and brokers under Monitoring → Services. Links open the service detail drawer.
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Overview
                        </th>
                        <td style={kvTd}>
                          <Link to={monitoringOverviewHref()} style={{ color: "var(--color-accent)" }}>
                            Open overview
                          </Link>
                          <span style={{ color: "var(--color-text-muted)" }}> — aggregate ingress health</span>
                        </td>
                      </tr>
                      {monitoringIngressLinks(protocol, httpF.restMode).map((row) => (
                        <tr key={row.service}>
                          <th scope="row" style={kvTh}>
                            {row.label}
                          </th>
                          <td style={kvTd}>
                            <Link
                              to={monitoringServiceHref(row.service)}
                              style={{ color: "var(--color-accent)" }}
                            >
                              Open in Monitoring
                            </Link>
                            {row.hint ? (
                              <span style={{ color: "var(--color-text-muted)" }}> — {row.hint}</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}

        {!editingDevice && (
          <section style={section} id="registered-devices-table">
            <h2 style={h2}>Registered devices</h2>
            <p style={muted}>
              Select <strong>Edit</strong> to change endpoint settings. Use the link above when editing to return to this
              table.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.65rem",
                alignItems: "center",
                marginBottom: "0.65rem",
              }}
            >
              <label style={{ ...lblSm, margin: 0, minWidth: "12rem" }}>
                Filter by endpoint activation
                <select
                  value={activationFilter}
                  onChange={(e) => setActivationFilter(e.target.value)}
                  style={inpSm}
                >
                  <option value="">All devices</option>
                  {ENDPOINT_ACTIVATION_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {formatActivationLabel(st)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={tableWrap}>
              <table style={tbl}>
                <caption style={tblCaption}>All registered devices — tabular list</caption>
                <thead>
                  <tr>
                    <th style={th}>Name</th>
                    <th style={th}>Site</th>
                    <th style={th}>Protocol</th>
                    <th style={th}>Activation</th>
                    <th style={th}>Status</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && devices.length === 0 ? (
                    <tr>
                      <td style={tdMuted} colSpan={6}>
                        Loading…
                      </td>
                    </tr>
                  ) : devices.length === 0 ? (
                    <tr>
                      <td style={tdMuted} colSpan={6}>
                        No devices yet.{" "}
                        <Link to="/devices/register" style={{ color: "var(--color-accent)" }}>
                          Register one
                        </Link>
                        .
                      </td>
                    </tr>
                  ) : (
                    devices.map((dev) => (
                      <tr key={dev.id}>
                        <td style={td}>{dev.name}</td>
                        <td style={td}>
                          <small>{sitesById[dev.site_id] ?? dev.site_id.slice(0, 8) + "…"}</small>
                        </td>
                        <td style={td}>
                          <small>{dev.endpoint ? protocolLabel(dev.endpoint.protocol) : "—"}</small>
                        </td>
                        <td style={td}>
                          {dev.endpoint?.activation_status ? (
                            <small style={activationStatusStyle(dev.endpoint.activation_status)}>
                              {formatActivationLabel(dev.endpoint.activation_status)}
                            </small>
                          ) : (
                            <small>—</small>
                          )}
                        </td>
                        <td style={td}>{dev.is_active ? "Active" : "Inactive"}</td>
                        <td style={td}>
                          <button type="button" style={editBtn} onClick={() => startEdit(dev)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}

const breadcrumbNav: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.35rem",
  fontSize: "0.82rem",
  marginBottom: "0.25rem",
};

const breadcrumbBtn: CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--color-accent)",
  fontFamily: "inherit",
  fontSize: "inherit",
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

const breadcrumbSep: CSSProperties = { color: "var(--color-text-muted)", userSelect: "none" };

const breadcrumbCurrent: CSSProperties = { color: "var(--color-text)", fontWeight: 600 };

const breadcrumbMuted: CSSProperties = { color: "var(--color-text-muted)", fontWeight: 400 };

const tblCaption: CSSProperties = {
  captionSide: "top",
  textAlign: "left",
  padding: "0.35rem 0.5rem",
  fontSize: "0.78rem",
  color: "var(--color-text-muted)",
  fontWeight: 500,
};

const stack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1.5rem",
  minHeight: 0,
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const section: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  background: "var(--color-surface-elevated)",
  padding: "1.25rem 1.5rem",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const h2: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
  fontWeight: 600,
  color: "var(--color-text)",
};

const muted: CSSProperties = {
  margin: "0.35rem 0 0",
  fontSize: "0.85rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.45,
};

const editLayoutRoot: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  marginTop: "0.65rem",
  minWidth: 0,
};

const editRow1: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "0.75rem",
  alignItems: "start",
};

const editRow2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
  gap: "0.75rem",
  alignItems: "start",
};

const editPanel: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  background: "var(--color-bg)",
  padding: "0.55rem 0.65rem",
  minWidth: 0,
};

const editPanelTitle: CSSProperties = {
  fontSize: "0.82rem",
  fontWeight: 600,
  color: "var(--color-text)",
  marginBottom: "0.45rem",
  paddingBottom: "0.35rem",
  borderBottom: "1px solid var(--color-border)",
};

const fieldGrid23: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 10.5rem), 1fr))",
  gap: "0.45rem 0.5rem",
  marginTop: "0.45rem",
};

const lblSm: CSSProperties = {
  display: "grid",
  gap: "0.15rem",
  fontSize: "0.72rem",
  color: "var(--color-text-muted)",
  minWidth: 0,
};

const inpSm: CSSProperties = {
  padding: "0.35rem 0.4rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  width: "100%",
  minWidth: 0,
};

const btnSm: CSSProperties = {
  padding: "0.45rem 0.75rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "0.82rem",
};

const secBtnSm: CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "0.82rem",
};

const btnRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.4rem",
  marginTop: "0.5rem",
};

const payloadHeaderRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
  flexShrink: 0,
};

const payloadTitle: CSSProperties = {
  fontSize: "0.82rem",
  fontWeight: 600,
  color: "var(--color-text)",
};

const refreshBtn: CSSProperties = {
  padding: "0.25rem 0.5rem",
  fontSize: "0.75rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  cursor: "pointer",
  fontWeight: 600,
};

const payloadLoadingLine: CSSProperties = {
  margin: "0.35rem 0 0",
  fontSize: "0.78rem",
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

const payloadHint: CSSProperties = {
  margin: "0.2rem 0 0",
  fontSize: "0.72rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.35,
};

const payloadEmpty: CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.78rem",
  color: "var(--color-text-muted)",
};

const payloadPre: CSSProperties = {
  margin: "0.35rem 0 0",
  flex: "1 1 auto",
  minHeight: "min(24vh, 200px)",
  overflow: "auto",
  fontSize: "0.72rem",
  lineHeight: 1.35,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "var(--color-surface-elevated)",
  padding: "0.4rem",
  borderRadius: "4px",
  border: "1px solid var(--color-border)",
};

const tableWrap: CSSProperties = {
  marginTop: "0.75rem",
  overflow: "auto",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
};

const tbl: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.88rem",
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.65rem",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text-muted)",
  fontWeight: 600,
};

const kvTable: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.78rem",
  marginTop: "0.35rem",
};

const kvTh: CSSProperties = {
  textAlign: "left",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  padding: "0.35rem 0.5rem 0.35rem 0",
  verticalAlign: "top",
  width: "42%",
  borderBottom: "1px solid var(--color-border-subtle, rgba(127,127,127,0.25))",
};

const kvTd: CSSProperties = {
  padding: "0.35rem 0",
  verticalAlign: "top",
  color: "var(--color-text)",
  borderBottom: "1px solid var(--color-border-subtle, rgba(127,127,127,0.25))",
  wordBreak: "break-word",
};

const payloadCell: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: "min(32vh, 280px)",
  maxHeight: "min(90vh, 720px)",
};

const payloadPreLabel: CSSProperties = {
  fontSize: "0.68rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  marginTop: "0.45rem",
  marginBottom: "0.15rem",
  textTransform: "uppercase",
  letterSpacing: "0.02em",
};

const td: CSSProperties = {
  padding: "0.45rem 0.65rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};

const tdMuted: CSSProperties = {
  ...td,
  color: "var(--color-text-muted)",
  padding: "1rem",
};

const editBtn: CSSProperties = {
  padding: "0.2rem 0.45rem",
  fontSize: "0.78rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  cursor: "pointer",
  fontFamily: "inherit",
  color: "var(--color-text)",
};

const validationPre: CSSProperties = {
  margin: "0.45rem 0 0",
  padding: "0.4rem",
  fontSize: "0.72rem",
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "var(--color-surface-elevated)",
  borderRadius: "4px",
  border: "1px solid var(--color-border)",
  fontFamily: "inherit",
};

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function MqttBridgeObservabilityTable({ o }: { o: DeviceEndpointObservability }) {
  const d = o.details || {};
  if (o.protocol !== "mqtt") {
    return (
      <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: 0 }}>
        Observability snapshot is for protocol &quot;{o.protocol}&quot;. Save as MQTT and run validation to refresh bridge
        details.
      </p>
    );
  }
  const topics = strList(d.configured_topics);
  const active = strList(d.active_subscribed_topics);
  const bridge = Boolean(d.bridge_snapshot_available);
  const sub = typeof d.subscription_state === "string" ? d.subscription_state : "—";
  const lastResync = typeof d.last_resync_at === "string" && d.last_resync_at ? d.last_resync_at : null;
  const resyncNote = typeof d.resync_note === "string" ? d.resync_note : "";
  const brokerConnCount =
    typeof d.mqtt_ingest_broker_connection_count === "number" ? d.mqtt_ingest_broker_connection_count : null;
  const ingestRoutes = Array.isArray(d.device_mqtt_ingest_routes) ? d.device_mqtt_ingest_routes : [];
  const activeDisplay = active.length
    ? active.join(", ")
    : bridge
      ? "(none reported)"
      : "Bridge snapshot not available (is worker-mqtt-bridge running with Redis?)";
  return (
    <table style={{ ...kvTable, marginTop: 0 }} aria-label="MQTT bridge observability">
      <tbody>
        <tr>
          <th scope="row" style={kvTh}>
            Configured topics (this device)
          </th>
          <td style={kvTd}>{topics.length ? topics.join(", ") : "—"}</td>
        </tr>
        <tr>
          <th scope="row" style={kvTh}>
            Active subscribed topics
          </th>
          <td style={kvTd}>{activeDisplay}</td>
        </tr>
        {brokerConnCount !== null ? (
          <tr>
            <th scope="row" style={kvTh}>
              Ingest broker connections
            </th>
            <td style={kvTd}>
              {brokerConnCount} subscriber client(s) — one MQTT connection per distinct saved broker profile (host, port,
              TLS, auth, client id)
            </td>
          </tr>
        ) : null}
        {ingestRoutes.length > 0 ? (
          <tr>
            <th scope="row" style={kvTh}>
              This device on broker
            </th>
            <td style={{ ...kvTd, fontSize: "0.72rem", lineHeight: 1.45 }}>
              {ingestRoutes.map((r: Record<string, unknown>, i: number) => {
                const host = String(r.broker_host ?? "—");
                const port = String(r.broker_port ?? "—");
                const tls = Boolean(r.use_tls);
                const auth = String(r.auth_mode ?? "—");
                const subs = Array.isArray(r.subscriptions) ? r.subscriptions : [];
                const topicLine = subs
                  .map((s) => (s && typeof s === "object" && "topic" in s ? String((s as { topic?: string }).topic) : ""))
                  .filter(Boolean)
                  .join(", ");
                return (
                  <div key={i} style={{ marginBottom: i < ingestRoutes.length - 1 ? "0.45rem" : 0 }}>
                    <strong>
                      {host}:{port}
                    </strong>
                    {tls ? " (TLS)" : ""} · auth {auth}
                    {topicLine ? (
                      <>
                        <br />
                        Topics: {topicLine}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </td>
          </tr>
        ) : null}
        <tr>
          <th scope="row" style={kvTh}>
            Subscription state
          </th>
          <td style={kvTd}>{sub}</td>
        </tr>
        <tr>
          <th scope="row" style={kvTh}>
            Last resync
          </th>
          <td style={kvTd}>{lastResync ? formatOptionalTs(lastResync) : "—"}</td>
        </tr>
        {typeof d.resync_interval_seconds === "number" ? (
          <tr>
            <th scope="row" style={kvTh}>
              Resync interval (s)
            </th>
            <td style={kvTd}>{d.resync_interval_seconds}</td>
          </tr>
        ) : null}
        {resyncNote ? (
          <tr>
            <th scope="row" style={kvTh}>
              Note
            </th>
            <td style={{ ...kvTd, color: "var(--color-text-muted)" }}>{resyncNote}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
