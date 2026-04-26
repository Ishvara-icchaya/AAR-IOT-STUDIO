import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrushCleaning, ClipboardCheck, Loader2, Save, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/api/client";
import type { DeviceRead } from "@/api/devices";
import {
  fetchDeviceEndpoint,
  validateDeviceEndpoint,
  type DeviceEndpointObservability,
  type DeviceEndpointRead,
} from "@/api/deviceEndpoints";
import { displayLivenessState, lastDataReceivedMs } from "@/lib/deviceLivenessDisplay";
import { AppButton, AppCard, AppEmptyState, AppField, AppGrid, AppInput, AppSelect, AppTabs, AppTextarea, AppToolbar } from "@/components/app";
import { DeviceEndpointStaticJsonPanel } from "@/components/device/DeviceEndpointStaticJsonPanel";
import { ConfigDrawer } from "@/components/ops/ConfigDrawer";
import { PageStatus } from "@/components/PageStatus";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { PageShell } from "@/layouts/PageShell";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import {
  configStructureSignature,
  jsonCloneForShape,
  normalizeConfigJsonForCompare,
  stableStringifyConfig,
} from "@/lib/configStructureSignature";
import {
  buildConfigFromFields,
  canonicalConfigFromStored,
  defaultFieldsForProtocol,
  type CoapFields,
  type HttpFields,
  INGEST_PROTOCOLS,
  type IngestProtocol,
  type MqttFields,
  normalizeProtocol,
  parseConfigToFields,
  type WebSocketFields,
} from "@/lib/deviceEndpointConfig";
import { activationStatusStyle, formatActivationLabel } from "@/lib/endpointActivation";

import "./device-register-page.css";

type SiteRow = { id: string; name: string };

type EndpointConfigTab = "connection" | "static_json";

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

function formatLastDataReceived(d: DeviceRead): string {
  const ms = lastDataReceivedMs(d);
  if (ms === null) return "—";
  return formatOptionalTs(new Date(ms).toISOString());
}

function livenessLabel(s: string | null | undefined): string {
  const x = String(s || "waiting_for_first_payload");
  if (x === "inactive") return "Inactive";
  if (x === "waiting_for_first_payload") return "Waiting first payload";
  if (x === "online") return "Online";
  if (x === "late") return "Late";
  if (x === "offline") return "Offline";
  if (x === "recovered") return "Recovered";
  return x;
}

function livenessStyle(s: string | null | undefined): CSSProperties {
  const x = String(s || "waiting_for_first_payload");
  if (x === "inactive") return { color: "var(--color-text-muted)", fontWeight: 500 };
  if (x === "online") return { color: "var(--color-success, #2e7d32)", fontWeight: 600 };
  if (x === "late") return { color: "var(--color-warning, #b8860b)", fontWeight: 600 };
  if (x === "offline") return { color: "var(--page-status-error-fg, #c62828)", fontWeight: 700 };
  if (x === "recovered") return { color: "var(--color-accent, #4da3ff)", fontWeight: 600 };
  return { color: "var(--color-text-muted)" };
}

function payloadReceiptLabel(status: string | undefined): string {
  const x = String(status || "none");
  if (x === "fresh") return "Fresh (within threshold)";
  if (x === "stale") return "Stale — no recent archive";
  return "No archive yet";
}

function payloadReceiptStyle(status: string | undefined): CSSProperties {
  const x = String(status || "none");
  if (x === "fresh") return { color: "var(--color-success, #2e7d32)", fontWeight: 600 };
  if (x === "stale") return { color: "var(--color-warning, #b8860b)", fontWeight: 600 };
  return { color: "var(--color-text-muted)", fontWeight: 500 };
}

function protocolLabel(p: string) {
  const n = normalizeProtocol(p);
  if (n === "http") return "HTTP / REST";
  if (n === "websocket") return "WebSocket";
  return n.toUpperCase();
}

export function DeviceManagePage() {
  const [devices, setDevices] = useState<DeviceRead[]>([]);
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useShellFeedback(err, null);
  const [editingDevice, setEditingDevice] = useState<DeviceRead | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const deviceIdFromQuery = searchParams.get("device");
  const navigate = useNavigate();

  const [protocol, setProtocol] = useState<IngestProtocol>("http");
  const [httpF, setHttpF] = useState<HttpFields>(() => parseConfigToFields("http", {}).http);
  const [mqttF, setMqttF] = useState<MqttFields>(() => parseConfigToFields("mqtt", {}).mqtt);
  const [coapF, setCoapF] = useState<CoapFields>(() => parseConfigToFields("coap", {}).coap);
  const [wsF, setWsF] = useState<WebSocketFields>(() => parseConfigToFields("websocket", {}).websocket);

  const [pollRealtime, setPollRealtime] = useState(false);
  const [pollIntervalSec, setPollIntervalSec] = useState(60);

  const [payloadMeta, setPayloadMeta] = useState<RawListItem | null>(null);
  const [payloadPreview, setPayloadPreview] = useState<RawPreview | null>(null);
  const [payloadErr, setPayloadErr] = useState<string | null>(null);
  const [payloadBlocking, setPayloadBlocking] = useState(false);
  const [payloadHydrated, setPayloadHydrated] = useState(false);

  const [observability, setObservability] = useState<DeviceEndpointObservability | null>(null);
  const [savedEndpoint, setSavedEndpoint] = useState<DeviceEndpointRead | null>(null);
  const [validating, setValidating] = useState(false);
  const [endpointConfigTab, setEndpointConfigTab] = useState<EndpointConfigTab>("connection");

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

  const { refreshToken } = useOpsShell();

  const refresh = useCallback(async (): Promise<DeviceRead[]> => {
    setLoading(true);
    setErr(null);
    try {
      const [devRes, siteList] = await Promise.all([
        apiFetch<{ items: DeviceRead[] }>("/devices"),
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
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || !deviceIdFromQuery) return;
    const match = devices.find((d) => d.id === deviceIdFromQuery);
    if (!match) {
      setSearchParams({}, { replace: true });
      return;
    }
    setEditingDevice(match);
    setErr(null);
    /* Keep ?device= in the URL for refresh/share; do not strip params (avoids a blank flash before the drawer). */
  }, [loading, deviceIdFromQuery, devices, setSearchParams]);

  useEffect(() => {
    if (refreshToken === 0) return;
    void refresh();
  }, [refreshToken, refresh]);

  useEffect(() => {
    if (!editingDevice) return;
    void loadEndpointFields(editingDevice.id);
  }, [editingDevice, loadEndpointFields]);

  useEffect(() => {
    setEndpointConfigTab("connection");
  }, [editingDevice?.id]);

  const previewRefreshMs =
    editingDevice && (pollRealtime || savedEndpoint?.polling_interval_seconds === 0) ? 2000 : 5000;

  /** Scrubber entry unlocks after archived ingest (endpoint) or a successful raw preview load for this session. */
  const scrubberUnlocked =
    !!savedEndpoint?.first_payload_at || (!!payloadMeta && payloadHydrated);

  const runPayloadFetch = useCallback(async (deviceId: string, mode: "initial" | "silent" | "manual") => {
    const showBlocking = mode !== "silent";
    if (showBlocking) setPayloadBlocking(true);
    if (mode === "initial") {
      setPayloadHydrated(false);
      setPayloadMeta(null);
      setPayloadPreview(null);
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

  function cancelEdit() {
    setEditingDevice(null);
    setObservability(null);
    setSavedEndpoint(null);
    navigate("/devices/register#registered-devices-table");
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
  /** REST Push: cadence is upstream-driven; device row interval is not used by the REST poller. */
  const pollingSecondsForSave =
    protocol === "http" && httpF.restMode === "inbound_hook" ? 0 : pollRealtime ? 0 : pollIntervalSec;

  const isHttpRestPush = protocol === "http" && httpF.restMode === "inbound_hook";
  const isHttpRestPull = protocol === "http" && httpF.restMode === "polling";

  /** Keep serialized HTTP Pull config interval aligned with the device polling row (worker reads both). */
  useEffect(() => {
    if (!isHttpRestPull) return;
    const sec = pollRealtime ? 60 : Math.max(5, pollIntervalSec);
    const s = String(sec);
    setHttpF((h) => (h.pollingIntervalSeconds === s ? h : { ...h, pollingIntervalSeconds: s }));
  }, [isHttpRestPull, pollRealtime, pollIntervalSec]);

  /** Stored config normalized through the same parse → build path as the form (drops legacy/extra keys). */
  const canonicalSavedConfig = useMemo(() => {
    if (!savedEndpoint) return null;
    try {
      return normalizeConfigJsonForCompare(
        jsonCloneForShape(
          canonicalConfigFromStored(savedEndpoint.protocol, savedEndpoint.config as Record<string, unknown>),
        ),
      );
    } catch {
      return null;
    }
  }, [savedEndpoint]);

  const hasUnsavedChanges = useMemo(() => {
    if (!savedEndpoint) return true;
    if (savedEndpoint.protocol !== protocol) return true;
    if (savedEndpoint.polling_interval_seconds !== pollingSecondsForSave) return true;
    try {
      const a = canonicalSavedConfig ?? normalizeConfigJsonForCompare(jsonCloneForShape(savedEndpoint.config ?? {}));
      const b = normalizeConfigJsonForCompare(jsonCloneForShape(builtConfigForCompare));
      return stableStringifyConfig(a) !== stableStringifyConfig(b);
    } catch {
      return true;
    }
  }, [savedEndpoint, protocol, pollingSecondsForSave, builtConfigForCompare, canonicalSavedConfig]);

  /** After first save, API requires a successful validation before persisting again; warning = connectivity OK, no payload yet; ok = operational. */
  const validationAllowsSave = useMemo(() => {
    if (!savedEndpoint) return true;
    const v = savedEndpoint.validation_status;
    return v === "warning" || v === "ok";
  }, [savedEndpoint]);

  /** Draft vs saved: same key topology as the editors emit (saved JSON is compared after canonical round-trip). */
  const configStructureMatches = useMemo(() => {
    if (!savedEndpoint || savedEndpoint.protocol !== protocol) return true;
    try {
      const a =
        canonicalSavedConfig ??
        normalizeConfigJsonForCompare(jsonCloneForShape(savedEndpoint.config ?? {}));
      const b = normalizeConfigJsonForCompare(jsonCloneForShape(builtConfigForCompare));
      return configStructureSignature(a) === configStructureSignature(b);
    } catch {
      return false;
    }
  }, [savedEndpoint, protocol, builtConfigForCompare, canonicalSavedConfig]);

  const canSaveConfiguration =
    !submitting && hasUnsavedChanges && validationAllowsSave && configStructureMatches;

  const deviceFromQuery = useMemo(
    () => (deviceIdFromQuery ? devices.find((d) => d.id === deviceIdFromQuery) : undefined),
    [deviceIdFromQuery, devices],
  );

  function validateEndpoint(): string | null {
    if (savedEndpoint && savedEndpoint.protocol === protocol) {
      try {
        const a =
          canonicalSavedConfig ??
          normalizeConfigJsonForCompare(jsonCloneForShape(savedEndpoint.config ?? {}));
        const b = normalizeConfigJsonForCompare(jsonCloneForShape(builtConfigForCompare));
        if (configStructureSignature(a) !== configStructureSignature(b)) {
          return (
            "Configuration structure must stay identical to what was saved — only values may change. " +
            "Undo added or removed keys (including inside JSON fields such as headers), then save again to avoid corrupting the endpoint."
          );
        }
      } catch {
        return "Could not verify configuration shape; fix invalid JSON or nested values.";
      }
    }
    if (protocol === "http") {
      if (httpF.restMode === "polling") {
        if (!httpF.pollingUrl.trim() && !httpF.host.trim()) {
          return "Pull from Upstream: set an upstream polling URL or Host (with Port + Path).";
        }
      }
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
    if (!isHttpRestPush && !pollRealtime && pollIntervalSec < 5) {
      return "Polling interval must be at least 5 seconds (or use Real time).";
    }
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
      setErr("Validate first; save is enabled when validation is warning or ok (not failed).");
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
    <PageShell variant="list" className="device-endpoint-page">
      <div style={stack}>
        <nav style={breadcrumbNav} aria-label="Manage devices">
          <span style={breadcrumbCurrent}>Devices</span>
          <span style={breadcrumbMuted}> — open a device from Register devices to configure its endpoint</span>
        </nav>

        <ConfigDrawer
          open={Boolean(editingDevice || deviceIdFromQuery)}
          onClose={cancelEdit}
          title="Device & endpoint"
          subtitle={editingDevice?.name ?? (deviceIdFromQuery ? "…" : undefined)}
          width={1680}
        >
          {editingDevice ? (
            <>
            <AppToolbar
              className="device-endpoint-drawer-toolbar"
              left={
                <nav className="device-endpoint-drawer__subnav" aria-label="Manage devices navigation">
                  <Link
                    to="/devices/register#registered-devices-table"
                    className="device-endpoint-drawer__device-list-link"
                    title="Return to Manage Devices — device table"
                  >
                    Device List
                  </Link>
                  <span className="device-endpoint-drawer__subnav-hint">
                    {" "}
                    / Manage Devices; return to the list anytime.
                  </span>
                  <span style={breadcrumbSep} aria-hidden>
                    {" "}
                    /{" "}
                  </span>
                  <span style={breadcrumbCurrent}>Edit · {editingDevice.name}</span>
                </nav>
              }
              right={
                <>
                  <button
                    type="button"
                    className="dm-btn dm-btn--outline"
                    disabled={validating || submitting}
                    title={
                      savedEndpoint
                        ? "Validate: checks broker/URL connectivity, payload receipt in Postgres, refreshes bridge observability, and reloads latest archived raw + preview."
                        : "Validate: requires a saved endpoint first — use Save, then Validate (or try now to see the server message)."
                    }
                    onClick={() => void runValidation()}
                  >
                    {validating ? (
                      <Loader2 size={16} strokeWidth={2} className="device-endpoint-toolbar-spin" aria-hidden />
                    ) : (
                      <ClipboardCheck size={16} strokeWidth={2} aria-hidden />
                    )}
                    {validating ? "Validating…" : "Validate"}
                  </button>
                  {scrubberUnlocked ? (
                    <Link
                      to="/scrubber/raw-select"
                      className="dm-btn dm-btn--outline"
                      style={{ textDecoration: "none" }}
                      title="Open Raw sample — pick archived raw, then Scrubber Studio"
                    >
                      <BrushCleaning size={16} strokeWidth={2} aria-hidden />
                      Scrubber
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="dm-btn dm-btn--outline"
                      disabled
                      title="Scrubber unlocks after the first archived payload is available (or once raw preview loads)."
                    >
                      <BrushCleaning size={16} strokeWidth={2} aria-hidden />
                      Scrubber
                    </button>
                  )}
                  <button
                    type="submit"
                    form="device-endpoint-form"
                    className="dm-btn dm-btn--outline"
                    disabled={!canSaveConfiguration || submitting}
                    title={
                      !configStructureMatches && savedEndpoint && savedEndpoint.protocol === protocol
                        ? "Save blocked: configuration layout (keys / nested shape) must match the saved configuration — only values may change."
                        : canSaveConfiguration
                          ? "Save configuration — persist protocol, polling, and connection settings."
                          : "Save is available when there are changes, structure matches the saved layout, and validation is warning or ok (not failed)."
                    }
                  >
                    {submitting ? (
                      <Loader2 size={16} strokeWidth={2} className="device-endpoint-toolbar-spin" aria-hidden />
                    ) : (
                      <Save size={16} strokeWidth={2} aria-hidden />
                    )}
                    {submitting ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="dm-btn dm-btn--outline"
                    onClick={cancelEdit}
                    disabled={submitting}
                    title="Close without saving — return to Register devices"
                  >
                    <X size={16} strokeWidth={2} aria-hidden />
                    Cancel
                  </button>
                </>
              }
            />
            <h2 style={{ ...h2, fontSize: "0.95rem", marginTop: "0.5rem" }}>Edit device</h2>
            <p style={{ ...muted, fontSize: "0.8rem" }}>
              <strong>{editingDevice.name}</strong> · {sitesById[editingDevice.site_id] ?? editingDevice.site_id.slice(0, 8) + "…"} · Status:{" "}
              <strong>{editingDevice.is_active ? "Active" : "Inactive"}</strong>
            </p>

            <div className="app-section" role="region" aria-label="Endpoint editor layout">
              <AppGrid columns={3}>
                <AppCard title="Endpoint configuration">
                  <AppTabs<EndpointConfigTab>
                    ariaLabel="Endpoint configuration sections"
                    tabs={[
                      { id: "connection", label: "Connection" },
                      { id: "static_json", label: "Static JSON" },
                    ]}
                    active={endpointConfigTab}
                    onChange={(id) => setEndpointConfigTab(id)}
                    plain
                  />
                  {endpointConfigTab === "connection" ? (
                    <>
                  {savedEndpoint && savedEndpoint.protocol === protocol && !configStructureMatches ? (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <PageStatus variant="warning" icon>
                        Configuration structure must match what was saved. Only field values may change — revert added or
                        removed keys (including in JSON text areas) before saving to avoid corrupting the endpoint.
                        {protocol === "mqtt" ? (
                          <span style={{ display: "block", marginTop: "0.35rem", fontSize: "0.78rem", opacity: 0.95 }}>
                            MQTT message payloads (e.g. fleet telemetry) are not stored in endpoint configuration — only
                            broker, topic, and related fields are.
                          </span>
                        ) : null}
                      </PageStatus>
                    </div>
                  ) : null}
                <form id="device-endpoint-form" onSubmit={saveEndpoint} style={{ minWidth: 0 }}>
                <AppGrid columns={3} className="app-grid--tight app-grid--form-row-margin">
                  <AppField size="sm" label="Protocol">
                    <AppSelect
                      value={protocol}
                      onChange={(e) => setProtocol(e.target.value as IngestProtocol)}
                      size="sm"
                      required
                    >
                      {INGEST_PROTOCOLS.map((opt) => (
                        <option key={opt} value={opt}>
                          {protocolLabel(opt)}
                        </option>
                      ))}
                    </AppSelect>
                  </AppField>
                  {isHttpRestPush ? (
                    <p className="app-grid__help-span-2">
                      <strong>Push to Platform:</strong> ingest cadence is controlled by the upstream system (each POST to the
                      platform API). No upstream URL is configured here.
                    </p>
                  ) : (
                    <>
                      <AppField size="sm" label="Polling">
                        <AppSelect
                          value={pollRealtime ? "rt" : "iv"}
                          onChange={(e) => setPollRealtime(e.target.value === "rt")}
                          size="sm"
                        >
                          <option value="rt">Real time (0s)</option>
                          <option value="iv">Interval</option>
                        </AppSelect>
                      </AppField>
                      <AppField size="sm" label="Interval (sec)">
                        <AppInput
                          type="number"
                          min={5}
                          max={86400}
                          disabled={pollRealtime}
                          value={pollIntervalSec}
                          onChange={(e) => setPollIntervalSec(Number(e.target.value))}
                          size="sm"
                          style={{ opacity: pollRealtime ? 0.5 : 1 }}
                        />
                      </AppField>
                    </>
                  )}
                </AppGrid>

                {protocol === "http" && (
                  <AppGrid columns={3} className="app-grid--tight app-grid--form-row-margin">
                    <AppField size="sm" label="REST integration">
                      <AppSelect
                        value={httpF.restMode}
                        onChange={(e) => {
                          const mode = e.target.value as "inbound_hook" | "polling";
                          setHttpF((prev) => {
                            if (mode === "polling" && prev.restMode === "inbound_hook") {
                              return defaultFieldsForProtocol("http") as HttpFields;
                            }
                            return { ...prev, restMode: mode };
                          });
                        }}
                        size="sm"
                      >
                        <option value="inbound_hook">Push to Platform</option>
                        <option value="polling">Pull from Upstream</option>
                      </AppSelect>
                    </AppField>
                    {isHttpRestPush ? (
                      <p className="app-grid__help-span-2">
                        Upstream systems send HTTP payloads to AAR-IoT-Studio. Use{" "}
                        <code>POST /api/v1/ingest/raw</code> with JWT auth (multipart body per product contract).
                      </p>
                    ) : null}
                  </AppGrid>
                )}

                {protocol === "http" && isHttpRestPull && (
                  <AppGrid columns={3} className="app-grid--tight app-grid--form-row-margin">
                    <AppField size="sm" label="Upstream URL (optional if Host + Port + Path below)" className="app-field--grid-span-full">
                      <AppInput
                        value={httpF.pollingUrl}
                        onChange={(e) => setHttpF({ ...httpF, pollingUrl: e.target.value })}
                        size="sm"
                        placeholder="https://upstream.example.com/api/readings"
                      />
                    </AppField>
                    <AppField size="sm" label="Host" className="app-field--grid-span-full">
                      <AppInput
                        value={httpF.host}
                        onChange={(e) => setHttpF({ ...httpF, host: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Path" className="app-field--grid-span-full">
                      <AppInput
                        value={httpF.path}
                        onChange={(e) => setHttpF({ ...httpF, path: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Port">
                      <AppInput
                        value={httpF.port}
                        onChange={(e) => setHttpF({ ...httpF, port: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Method">
                      <AppSelect
                        value={httpF.method}
                        onChange={(e) => setHttpF({ ...httpF, method: e.target.value })}
                        size="sm"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="TLS">
                      <AppSelect
                        value={httpF.useTls ? "y" : "n"}
                        onChange={(e) => setHttpF({ ...httpF, useTls: e.target.value === "y" })}
                        size="sm"
                      >
                        <option value="y">Yes (HTTPS)</option>
                        <option value="n">No (HTTP)</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="Timeout (s)">
                      <AppInput
                        value={httpF.timeoutSeconds}
                        onChange={(e) => setHttpF({ ...httpF, timeoutSeconds: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Extra headers (JSON object, optional)" className="app-field--grid-span-full">
                      <AppTextarea
                        value={httpF.headersJson}
                        onChange={(e) => setHttpF({ ...httpF, headersJson: e.target.value })}
                        size="sm"
                        mono
                        style={{ minHeight: "4rem" }}
                        placeholder='{"X-Custom":"value"}'
                      />
                    </AppField>
                    <AppField size="sm" label="Auth">
                      <AppSelect
                        value={httpF.authType}
                        onChange={(e) =>
                          setHttpF({ ...httpF, authType: e.target.value as HttpFields["authType"] })
                        }
                        size="sm"
                      >
                        <option value="none">None</option>
                        <option value="bearer">Bearer token (Authorization)</option>
                        <option value="header">Custom header</option>
                      </AppSelect>
                    </AppField>
                    {httpF.authType === "header" ? (
                      <AppField size="sm" label="Header name">
                        <AppInput
                          value={httpF.authHeaderName}
                          onChange={(e) => setHttpF({ ...httpF, authHeaderName: e.target.value })}
                          size="sm"
                        />
                      </AppField>
                    ) : null}
                    {httpF.authType !== "none" ? (
                      <AppField
                        size="sm"
                        label="Secret / token"
                        className={httpF.authType === "header" ? "app-field--grid-span-full" : undefined}
                      >
                        <AppInput
                          type="password"
                          value={httpF.authHeaderValue}
                          onChange={(e) => setHttpF({ ...httpF, authHeaderValue: e.target.value })}
                          size="sm"
                          autoComplete="off"
                        />
                      </AppField>
                    ) : null}
                  </AppGrid>
                )}

                {protocol === "mqtt" && (
                  <AppGrid columns={3} className="app-grid--tight app-grid--form-row-margin">
                    <AppField size="sm" label="Broker mode">
                      <AppSelect
                        value={mqttF.brokerMode}
                        onChange={(e) =>
                          setMqttF({ ...mqttF, brokerMode: e.target.value as "internal" | "external" })
                        }
                        size="sm"
                      >
                        <option value="internal">Internal (platform Mosquitto)</option>
                        <option value="external">External broker</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="Broker host">
                      <AppInput
                        value={mqttF.host}
                        onChange={(e) => setMqttF({ ...mqttF, host: e.target.value })}
                        size="sm"
                        placeholder={
                          mqttF.brokerMode === "internal"
                            ? "mosquitto (default if empty)"
                            : "e.g. 192.168.x.x"
                        }
                      />
                    </AppField>
                    <AppField size="sm" label="Broker port">
                      <AppInput
                        value={mqttF.port}
                        onChange={(e) => setMqttF({ ...mqttF, port: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Topic" className="app-field--grid-span-full">
                      <AppInput
                        value={mqttF.topic}
                        onChange={(e) => setMqttF({ ...mqttF, topic: e.target.value })}
                        size="sm"
                        placeholder="e.g. factory/# or factory/telemetry"
                      />
                    </AppField>
                    <p className="app-grid__help-span-full">
                      The bridge subscribes with this filter; it must match the full published topic path. An exact
                      filter <code>factory/telemetry</code> does not receive messages on{" "}
                      <code>factory/telemetry/truck-001</code> — use a wildcard such as <code>factory/#</code> or{" "}
                      <code>factory/+/telemetry</code> when your fleet publishes under a <code>factory/…</code> hierarchy.
                      Patterns like <code>devices/+/telemetry</code> are supported. After validate, the bridge reloads
                      within ~90s (or restart <code>worker-mqtt-bridge</code>). If upstream stops sending, liveness moves
                      to late/offline by design; widen the topic only if messages still publish on the broker but never
                      reach the platform.
                    </p>
                    <AppField size="sm" label="QoS">
                      <AppSelect
                        value={mqttF.qos}
                        onChange={(e) => setMqttF({ ...mqttF, qos: e.target.value })}
                        size="sm"
                      >
                        <option value="0">0</option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="Username">
                      <AppInput
                        value={mqttF.username}
                        onChange={(e) => setMqttF({ ...mqttF, username: e.target.value })}
                        size="sm"
                        autoComplete="off"
                      />
                    </AppField>
                    <AppField size="sm" label="Password">
                      <AppInput
                        type="password"
                        value={mqttF.password}
                        onChange={(e) => setMqttF({ ...mqttF, password: e.target.value })}
                        size="sm"
                        autoComplete="off"
                      />
                    </AppField>
                    <AppField size="sm" label="Client ID">
                      <AppInput
                        value={mqttF.clientId}
                        onChange={(e) => setMqttF({ ...mqttF, clientId: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                  </AppGrid>
                )}

                {protocol === "coap" && (
                  <AppGrid columns={3} className="app-grid--tight app-grid--form-row-margin">
                    <p className="app-grid__help-span-full app-grid__help-span-full--md">
                      CoAP is modeled as a <strong>listener/adapter</strong> (not a broker). Payloads must be normalized and
                      written through the canonical raw ingest path when the adapter is deployed.
                    </p>
                    <AppField size="sm" label="Host" className="app-field--grid-span-full">
                      <AppInput
                        value={coapF.host}
                        onChange={(e) => setCoapF({ ...coapF, host: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Path" className="app-field--grid-span-full">
                      <AppInput
                        value={coapF.path}
                        onChange={(e) => setCoapF({ ...coapF, path: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Port">
                      <AppInput
                        value={coapF.port}
                        onChange={(e) => setCoapF({ ...coapF, port: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Method">
                      <AppSelect
                        value={coapF.method}
                        onChange={(e) => setCoapF({ ...coapF, method: e.target.value })}
                        size="sm"
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="Security">
                      <AppSelect
                        value={coapF.security}
                        onChange={(e) => setCoapF({ ...coapF, security: e.target.value })}
                        size="sm"
                      >
                        <option value="none">None</option>
                        <option value="dtls">DTLS</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="Timeout (s)">
                      <AppInput
                        value={coapF.timeoutSeconds}
                        onChange={(e) => setCoapF({ ...coapF, timeoutSeconds: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Observe (CoAP observe)">
                      <AppSelect
                        value={coapF.observe ? "y" : "n"}
                        onChange={(e) => setCoapF({ ...coapF, observe: e.target.value === "y" })}
                        size="sm"
                      >
                        <option value="n">No</option>
                        <option value="y">Yes</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="Poll interval (sec)">
                      <AppInput
                        type="number"
                        min={5}
                        value={coapF.pollIntervalSeconds}
                        onChange={(e) => setCoapF({ ...coapF, pollIntervalSeconds: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                  </AppGrid>
                )}

                {protocol === "websocket" && (
                  <AppGrid columns={3} className="app-grid--tight app-grid--form-row-margin">
                    <p className="app-grid__help-span-full app-grid__help-span-full--md">
                      WebSocket ingest is a <strong>platform listener</strong>; configuration here is consumed by the ingest
                      adapter (same canonical archive + Kafka path as REST/MQTT).
                    </p>
                    <AppField size="sm" label="WebSocket URL" className="app-field--grid-span-full">
                      <AppInput
                        value={wsF.url}
                        onChange={(e) => setWsF({ ...wsF, url: e.target.value })}
                        size="sm"
                        placeholder="ws://host:8001/stream or wss://…"
                      />
                    </AppField>
                    <AppField size="sm" label="TLS (wss)">
                      <AppSelect
                        value={wsF.useTls ? "y" : "n"}
                        onChange={(e) => setWsF({ ...wsF, useTls: e.target.value === "y" })}
                        size="sm"
                      >
                        <option value="n">ws</option>
                        <option value="y">wss</option>
                      </AppSelect>
                    </AppField>
                    <AppField size="sm" label="Subprotocol">
                      <AppInput
                        value={wsF.subprotocol}
                        onChange={(e) => setWsF({ ...wsF, subprotocol: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Reconnect delay (s)">
                      <AppInput
                        type="number"
                        min={1}
                        value={wsF.reconnectDelaySeconds}
                        onChange={(e) => setWsF({ ...wsF, reconnectDelaySeconds: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Ping interval (s)">
                      <AppInput
                        type="number"
                        min={0}
                        value={wsF.pingIntervalSeconds}
                        onChange={(e) => setWsF({ ...wsF, pingIntervalSeconds: e.target.value })}
                        size="sm"
                      />
                    </AppField>
                    <AppField size="sm" label="Connection headers (JSON, optional)" className="app-field--grid-span-full">
                      <AppTextarea
                        value={wsF.headersJson}
                        onChange={(e) => setWsF({ ...wsF, headersJson: e.target.value })}
                        size="sm"
                        mono
                        style={{ minHeight: "3.5rem" }}
                      />
                    </AppField>
                  </AppGrid>
                )}

                {!canSaveConfiguration && hasUnsavedChanges && savedEndpoint ? (
                  <p style={{ ...muted, fontSize: "0.72rem", margin: "0.35rem 0 0" }}>
                    Validate to enable save (status must be <strong>warning</strong> or <strong>ok</strong>, not failed).
                  </p>
                ) : null}
                {!hasUnsavedChanges && savedEndpoint ? (
                  <p style={{ ...muted, fontSize: "0.72rem", margin: "0.35rem 0 0" }}>
                    No changes to save — edit fields or use <strong>Cancel</strong> to return to the device table.
                  </p>
                ) : null}
              </form>
                    </>
                  ) : editingDevice ? (
                    <DeviceEndpointStaticJsonPanel
                      deviceId={editingDevice.id}
                      siteId={editingDevice.site_id}
                      siteName={sitesById[editingDevice.site_id]}
                      deviceName={editingDevice.name}
                    />
                  ) : null}
                </AppCard>
                <AppCard
                  title="Latest archived raw"
                  headerExtra={
                    <AppButton
                      variant="secondary"
                      disabled={payloadBlocking || !editingDevice}
                      onClick={() => editingDevice && void runPayloadFetch(editingDevice.id, "manual")}
                    >
                      Refresh preview
                    </AppButton>
                  }
                  bodyClassName="app-card__body"
                >
                  <div className="device-endpoint-payload-panel" style={payloadCell}>
                  {payloadBlocking ? <p style={payloadLoadingLine}>Loading ingested payload…</p> : null}
                  {payloadErr ? (
                    <p style={{ color: "var(--page-status-error-fg)", fontSize: "0.78rem" }}>{payloadErr}</p>
                  ) : null}
                  {!payloadBlocking && !payloadMeta && !payloadErr ? (
                    <AppEmptyState title="No archived raw">
                      <p style={{ margin: 0 }}>Ingest or refresh when data is available.</p>
                    </AppEmptyState>
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
                </AppCard>

                <AppCard title="Endpoint runtime status">
                  <table style={kvTable} aria-label="Endpoint runtime series">
                    <tbody>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Liveness state
                        </th>
                        <td style={kvTd}>
                          <span style={livenessStyle(displayLivenessState(editingDevice))}>
                            {livenessLabel(displayLivenessState(editingDevice))}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Last data received
                        </th>
                        <td style={kvTd}>{formatLastDataReceived(editingDevice)}</td>
                      </tr>
                      <tr>
                        <th scope="row" style={kvTh}>
                          Device last_seen_at
                        </th>
                        <td style={kvTd}>{formatOptionalTs(editingDevice.last_seen_at)}</td>
                      </tr>
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
                          Archived raw timeliness
                        </th>
                        <td style={kvTd}>
                          <span style={payloadReceiptStyle(observability?.payload_receipt_status)}>
                            {payloadReceiptLabel(observability?.payload_receipt_status)}
                          </span>
                          {(observability?.payload_receipt_status === "fresh" ||
                            observability?.payload_receipt_status === "stale") &&
                          observability?.payload_age_seconds != null &&
                          observability?.payload_receipt_threshold_seconds != null ? (
                            <span
                              style={{
                                ...muted,
                                display: "block",
                                fontSize: "0.72rem",
                                marginTop: "0.2rem",
                              }}
                            >
                              Last raw ~{observability.payload_age_seconds}s ago (threshold{" "}
                              {observability.payload_receipt_threshold_seconds}s, same basis as liveness).
                            </span>
                          ) : null}
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
                      Use <strong>Validate</strong> in the toolbar after the first save to refresh connectivity and payload-receipt checks.
                    </p>
                  )}
                </AppCard>
              </AppGrid>
            </div>
            </>
          ) : deviceIdFromQuery && (loading || (deviceFromQuery && !editingDevice)) ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.75rem",
                padding: "2.5rem 1rem",
                color: "var(--color-text-muted)",
                fontSize: "0.9rem",
              }}
            >
              <Loader2 size={28} strokeWidth={2} className="device-endpoint-toolbar-spin" aria-hidden />
              <span>Loading endpoint configuration…</span>
            </div>
          ) : deviceIdFromQuery && !loading && !deviceFromQuery ? (
            <div
              style={{
                padding: "1.5rem 1rem",
                color: "var(--color-text-muted)",
                fontSize: "0.88rem",
                textAlign: "center",
              }}
            >
              Device not found or you no longer have access. This panel will close when you leave the page or use
              Back.
            </div>
          ) : null}
        </ConfigDrawer>

        {!editingDevice ? (
          <AppEmptyState title="Configure a device endpoint">
            <p style={{ margin: 0 }}>
              Use{" "}
              <Link to="/devices/register" style={{ color: "var(--color-accent)" }}>
                Register devices
              </Link>{" "}
              to view and manage the device list (activation, status, last data). Choose <strong>Manage</strong> on a
              device to open endpoint configuration here.
            </p>
          </AppEmptyState>
        ) : null}
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

const breadcrumbSep: CSSProperties = { color: "var(--color-text-muted)", userSelect: "none" };

const breadcrumbCurrent: CSSProperties = { color: "var(--color-text)", fontWeight: 600 };

const breadcrumbMuted: CSSProperties = { color: "var(--color-text-muted)", fontWeight: 400 };

const stack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1.5rem",
  minHeight: 0,
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
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

