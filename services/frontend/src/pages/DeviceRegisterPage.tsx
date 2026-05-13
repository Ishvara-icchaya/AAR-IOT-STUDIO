import type { ChangeEvent, CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson2,
  Pencil,
  Search,
  LayoutList,
  Rocket,
  Settings2,
  Upload,
} from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { apiFetch, isApiHttpError } from "@/api/client";
import { validateDeviceEndpoint } from "@/api/deviceEndpoints";
import {
  commitDeviceImportRows,
  createDevice,
  deviceDetailsUrl,
  getDevice,
  listDevices,
  updateDevice,
  validateDeviceImportRows,
  type DeviceRead,
} from "@/api/devices";
import { useOpsShell, type OpsTimeRange } from "@/contexts/OpsShellContext";
import { useSitePermissionsOptional } from "@/contexts/SitePermissionsContext";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { AppModalShell } from "@/components/app/AppModalShell";
import { AppTabs } from "@/components/app";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsStatusPill, type OpsVariant } from "@/components/ops/OpsStatusPill";
import { AarButton } from "@/components/system/AarButton";
import { PageShell } from "@/layouts/PageShell";
import { userIsAdmin } from "@/layouts/shell/navigation";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import { ScrubberRawSelectModal } from "@/pages/scrubber2/ScrubberRawSelectModal";
import { footprintOperationalPillVariant } from "@/lib/deviceOperationalFootprintUi";
import { normalizeProtocol } from "@/lib/deviceEndpointConfig";
import { displayLivenessState, lastDataReceivedMs } from "@/lib/deviceLivenessDisplay";
import { ENDPOINT_ACTIVATION_STATUSES, formatActivationLabel } from "@/lib/endpointActivation";
import { AppIcon, ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";
import {
  deviceCsvRowToImportApiRow,
  parseDeviceImportCsv,
  type DeviceCsvImportRow,
  type DeviceCsvParseRowError,
} from "@/lib/deviceImportCsv";
import { formatStatusDisplayLabel } from "@/lib/statusDisplay";
import {
  formatFirmwareChannelLabel,
  formatVersionStatusLabel,
  firmwareChannelPillSuffix,
  normalizeFirmwareChannel,
  normalizeVersionStatus,
  versionStatusPillSuffix,
} from "@/lib/deviceVersionUi";
import { DeviceBoolPill, DeviceVersionHistoryDrawer } from "@/components/device/DeviceVersionHistoryDrawer";
import { OtaCampaignNewWizard } from "@/components/ota/OtaCampaignNewWizard";
import { OtaCampaignsListPanel } from "@/components/ota/OtaCampaignsListPanel";

import "./device-register-page.css";
import "@/pages/ingest-endpoints-page.css";

type TimeScope = "all" | "last_1_hour" | "last_24_hours" | "last_7_days" | "last_30_days";

type DeviceRegModalTab = "identity" | "readiness";

function parseOptionalPositiveInt(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
}

function opsTimeRangeToScope(tr: OpsTimeRange): TimeScope {
  switch (tr) {
    case "1h":
      return "last_1_hour";
    case "24h":
      return "last_24_hours";
    case "7d":
      return "last_7_days";
    case "30d":
      return "last_30_days";
    default:
      return "last_24_hours";
  }
}

function matchesTimeScope(d: DeviceRead, scope: TimeScope): boolean {
  if (scope === "all") return true;
  const t = lastDataReceivedMs(d);
  // Newly registered devices (no endpoint / no payload timestamps yet) must stay visible;
  // only filter out devices whose *last* ingest is older than the shell window.
  if (t === null) return true;
  const age = Date.now() - t;
  const limits: Record<Exclude<TimeScope, "all">, number> = {
    last_1_hour: 3600 * 1000,
    last_24_hours: 24 * 3600 * 1000,
    last_7_days: 7 * 24 * 3600 * 1000,
    last_30_days: 30 * 24 * 3600 * 1000,
  };
  return age <= limits[scope];
}

function formatRelativeShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "—";
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}

function exportDevicesCsv(rows: DeviceRead[], sitesById: Record<string, string>) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = [
    "name",
    "site",
    "description",
    "protocol",
    "activation",
    "connectivity",
    "liveness",
    "operational_footprint",
    "last_data",
  ];
  const lines = [header.join(",")];
  for (const d of rows) {
    const site = sitesById[d.site_id] ?? d.site_id;
    const proto = d.endpoint?.protocol ? normalizeProtocol(d.endpoint.protocol) : "";
    const act = d.endpoint?.activation_status ?? "";
    const conn = d.endpoint?.validation_status ?? "";
    const live = displayLivenessState(d);
    const footprint = d.footprint_operational_status ?? "";
    const lastMs = lastDataReceivedMs(d);
    const last = lastMs != null ? new Date(lastMs).toISOString() : "";
    lines.push(
      [
        esc(d.name),
        esc(site),
        esc((d.description ?? "").replace(/\s+/g, " ").trim()),
        esc(proto),
        esc(act),
        esc(conn),
        esc(live),
        esc(footprint),
        esc(last),
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `devices-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

type SiteRow = { id: string; name: string };

type ModalMode = "create" | "edit" | null;

/** Raw keys for connectivity column (formatted in ``OpsStatusPill``). */
function connectivityStatusKey(d: DeviceRead): string {
  if (!d.endpoint) return "no_endpoint";
  const v = d.endpoint.validation_status?.trim();
  if (!v) return "not_checked";
  return v;
}

/** Raw keys for composite status column (liveness + device/activation gates). */
function compositeDeviceStatusKey(d: DeviceRead): string {
  if (d.is_active === false) return "inactive";
  const activation = d.endpoint?.activation_status;
  if (activation === "inactive") return "inactive";
  if (activation === "error") return "error";
  return displayLivenessState(d);
}

/** Bucket keys for client-side hide filters (applied after name/description search results load). */
function activationBucket(d: DeviceRead): string {
  if (!d.endpoint) return "no_endpoint";
  const s = d.endpoint.activation_status?.trim();
  if (!s) return "unknown";
  if ((ENDPOINT_ACTIVATION_STATUSES as readonly string[]).includes(s)) return s;
  return "unknown";
}

function connectivityBucket(d: DeviceRead): string {
  if (!d.endpoint) return "no_endpoint";
  const v = d.endpoint.validation_status?.trim();
  if (!v) return "not_checked";
  if (v === "ok") return "ok";
  if (v === "warning") return "warning";
  if (v === "failed") return "failed";
  return "other";
}

function livenessBucket(d: DeviceRead): string {
  return displayLivenessState(d);
}

function protocolBucket(d: DeviceRead): string {
  const p = d.endpoint?.protocol;
  if (!p || !String(p).trim()) return "";
  return normalizeProtocol(String(p));
}

function protocolFilterLabel(bucket: string): string {
  if (bucket === "http") return "HTTP / REST";
  if (bucket === "websocket") return "WebSocket";
  return bucket.toUpperCase();
}

/** Positive filter: devices with no saved protocol on the endpoint. */
const PROTOCOL_FILTER_NONE = "__proto_none__";

/** Exclusive bucket for KPI cards (matches reference: online / degraded / offline / error). */
function kpiBucket(d: DeviceRead): "error" | "offline" | "degraded" | "online" | "other" {
  const act = d.endpoint?.activation_status;
  const val = d.endpoint?.validation_status;
  if (act === "error" || val === "failed") return "error";
  const live = livenessBucket(d);
  if (live === "offline" || live === "inactive") return "offline";
  if (live === "late" || val === "warning") return "degraded";
  if (live === "online" || live === "recovered") return "online";
  return "other";
}

function activationPillVariant(status: string | undefined): OpsVariant {
  if (!status) return "muted";
  if (status === "active") return "online";
  if (status === "error") return "offline";
  if (status === "waiting_for_first_payload") return "waiting";
  return "muted";
}

function connectivityPillVariant(d: DeviceRead): OpsVariant {
  if (!d.endpoint) return "muted";
  const v = d.endpoint.validation_status;
  if (v === "ok") return "online";
  if (v === "warning") return "muted";
  if (v === "failed") return "offline";
  return "muted";
}

function statusDotKind(d: DeviceRead): OpsVariant {
  if (d.is_active === false) return "muted";
  const activation = d.endpoint?.activation_status;
  if (activation === "error") return "offline";
  if (activation === "inactive") return "muted";
  const live = String(displayLivenessState(d));
  if (live === "inactive") return "muted";
  if (live === "online" || live === "recovered") return "online";
  if (live === "offline") return "offline";
  if (live === "late") return "muted";
  return "muted";
}

const HIDE_ACTIVATION_OPTIONS: { key: string; label: string }[] = [
  { key: "no_endpoint", label: "No endpoint" },
  ...ENDPOINT_ACTIVATION_STATUSES.map((s) => ({
    key: s,
    label: formatActivationLabel(s),
  })),
  { key: "unknown", label: "Unknown activation" },
];

const HIDE_CONNECTIVITY_OPTIONS: { key: string; label: string }[] = [
  { key: "no_endpoint", label: formatStatusDisplayLabel("no_endpoint") },
  { key: "not_checked", label: formatStatusDisplayLabel("not_checked") },
  { key: "ok", label: formatStatusDisplayLabel("ok") },
  { key: "warning", label: formatStatusDisplayLabel("warning") },
  { key: "failed", label: formatStatusDisplayLabel("failed") },
  { key: "other", label: formatStatusDisplayLabel("other") },
];

const DEVICE_TABLE_PAGE_SIZE = 25;

/** Operational lineage (`footprint_*`); set true to show the table column again. */
const SHOW_DEVICE_OPERATIONAL_FOOTPRINT_COLUMN = false;

const HIDE_STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: "inactive", label: formatStatusDisplayLabel("inactive") },
  { key: "waiting_for_first_payload", label: formatStatusDisplayLabel("waiting_for_first_payload") },
  { key: "online", label: formatStatusDisplayLabel("online") },
  { key: "late", label: formatStatusDisplayLabel("late") },
  { key: "offline", label: formatStatusDisplayLabel("offline") },
  { key: "recovered", label: formatStatusDisplayLabel("recovered") },
];

function connectivityTitle(d: DeviceRead): string | undefined {
  if (!d.endpoint) return "Configure an endpoint on Manage device to enable connectivity checks.";
  const parts: string[] = [];
  const detail = d.endpoint.validation_detail;
  if (detail?.trim()) parts.push(detail.trim());
  const lv = d.endpoint.last_verified_at;
  if (lv) {
    try {
      parts.push(`Last verified: ${new Date(lv).toLocaleString()}`);
    } catch {
      parts.push(`Last verified: ${lv}`);
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}

export function DeviceRegisterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { me } = useAuth();
  const isAdmin = userIsAdmin(me?.role, me?.is_superuser);
  const sitePerms = useSitePermissionsOptional();
  const canDevicesWrite = Boolean(isAdmin || sitePerms?.hasUnion("devices.write"));
  const canDevicesImport = Boolean(isAdmin || sitePerms?.hasUnion("devices.import"));
  const canOtaCreate = Boolean(isAdmin || sitePerms?.hasUnion("ota.create"));
  const { siteId: opsSiteId, timeRange: opsTimeRange, refreshToken } = useOpsShell();
  const timeScope = useMemo(() => opsTimeRangeToScope(opsTimeRange), [opsTimeRange]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [items, setItems] = useState<DeviceRead[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [checkingConnectivity, setCheckingConnectivity] = useState(false);
  useShellFeedback(err, ok);

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterActivation, setFilterActivation] = useState("all");
  const [filterConnectivity, setFilterConnectivity] = useState("all");
  const [filterProtocol, setFilterProtocol] = useState("all");

  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [siteId, setSiteId] = useState("");
  const [deviceModalTab, setDeviceModalTab] = useState<DeviceRegModalTab>("identity");
  const [icon, setIcon] = useState("");
  const [expectedInterval, setExpectedInterval] = useState("");
  const [lateThreshold, setLateThreshold] = useState("");
  const [offlineThreshold, setOfflineThreshold] = useState("");
  const [firmwareVersion, setFirmwareVersion] = useState("");
  const [firmwareChannel, setFirmwareChannel] = useState<"" | "stable" | "beta" | "dev" | "custom">("");
  const [otaSupported, setOtaSupported] = useState(false);
  const [rollbackSupported, setRollbackSupported] = useState(false);

  const [rawSampleOpen, setRawSampleOpen] = useState(false);
  const [rawSampleDeviceId, setRawSampleDeviceId] = useState("");
  const [rawSampleDeviceName, setRawSampleDeviceName] = useState("");

  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importSourceLabel, setImportSourceLabel] = useState<string | null>(null);
  const [importParsed, setImportParsed] = useState<{
    devices: DeviceCsvImportRow[];
    parseErrors: string[];
    rowParseErrors: DeviceCsvParseRowError[];
  } | null>(null);
  const [importValidation, setImportValidation] = useState<{
    ok: boolean;
    row_errors: { line: number; message: string }[];
  } | null>(null);
  const [importValidateBusy, setImportValidateBusy] = useState(false);
  const [importCommitBusy, setImportCommitBusy] = useState(false);
  const [versionDrawerDeviceId, setVersionDrawerDeviceId] = useState<string | null>(null);
  const [versionDrawerFetched, setVersionDrawerFetched] = useState<DeviceRead | null>(null);
  const [otaListOpen, setOtaListOpen] = useState(false);
  const [otaNewOpen, setOtaNewOpen] = useState(false);
  const [otaWizardSiteId, setOtaWizardSiteId] = useState<string | null>(null);
  const [otaWizardDeviceId, setOtaWizardDeviceId] = useState<string | null>(null);
  const [otaWizardDeviceName, setOtaWizardDeviceName] = useState<string | null>(null);
  const [otaWizardSiteName, setOtaWizardSiteName] = useState<string | null>(null);

  const openRawSampleModal = useCallback((d: DeviceRead) => {
    setRawSampleDeviceId(d.id);
    setRawSampleDeviceName(d.name);
    setRawSampleOpen(true);
  }, []);

  const closeRawSampleModal = useCallback(() => {
    setRawSampleOpen(false);
  }, []);

  const openImportModal = useCallback(() => {
    setImportModalOpen(true);
    setImportCsvText("");
    setImportSourceLabel(null);
    setImportParsed(null);
    setImportValidation(null);
  }, []);

  const closeImportModal = useCallback(() => {
    if (importValidateBusy || importCommitBusy) return;
    setImportModalOpen(false);
    setImportCsvText("");
    setImportSourceLabel(null);
    setImportParsed(null);
    setImportValidation(null);
  }, [importValidateBusy, importCommitBusy]);

  const patchImportRow = useCallback((line: number, patch: Partial<DeviceCsvImportRow>) => {
    setImportParsed((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        devices: prev.devices.map((d) => (d.line === line ? { ...d, ...patch } : d)),
      };
    });
    setImportValidation(null);
  }, []);

  const applyParsedFromText = useCallback(
    (text: string) => {
      const { devices, errors, rowParseErrors } = parseDeviceImportCsv(text, sites);
      setImportParsed({ devices, parseErrors: errors, rowParseErrors });
      setImportValidation(null);
    },
    [sites],
  );

  const runParsePreview = useCallback(() => {
    applyParsedFromText(importCsvText);
  }, [applyParsedFromText, importCsvText]);

  const onModalImportFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        setImportCsvText(text);
        setImportSourceLabel(file.name);
        applyParsedFromText(text);
      } catch (ex) {
        setErr(ex instanceof Error ? ex.message : "Could not read CSV file.");
      }
    },
    [applyParsedFromText],
  );

  const loadSites = useCallback(async () => {
    try {
      const data = await apiFetch<SiteRow[]>("/administration/sites");
      setSites(data ?? []);
      const map: Record<string, string> = {};
      for (const s of data ?? []) map[s.id] = s.name;
      setSitesById(map);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load sites");
    }
  }, []);

  const loadDevices = useCallback(async (q: string): Promise<DeviceRead[]> => {
    setTableLoading(true);
    setErr(null);
    try {
      const list = await listDevices({
        q: q.trim() || undefined,
        site_id: opsSiteId?.trim() || undefined,
      });
      setItems(list);
      return list;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load devices");
      return [];
    } finally {
      setTableLoading(false);
      setLoading(false);
    }
  }, [opsSiteId]);

  const runValidateImport = useCallback(async () => {
    if (!importParsed?.devices.length) return;
    setImportValidateBusy(true);
    setErr(null);
    setOk(null);
    try {
      const rows = importParsed.devices.map((d) => deviceCsvRowToImportApiRow(d));
      const res = await validateDeviceImportRows(rows, importSourceLabel);
      if (!res) {
        setErr("Validation returned no data.");
        setImportValidation(null);
        return;
      }
      setImportValidation({ ok: res.ok, row_errors: res.row_errors ?? [] });
      if (!res.ok) {
        setErr(`Validation found ${(res.row_errors ?? []).length} issue(s). See the Validation column.`);
      } else {
        setOk("Validation passed. You can save and begin import.");
      }
    } catch (e) {
      setErr(isApiHttpError(e) ? e.message : e instanceof Error ? e.message : "Validation request failed.");
      setImportValidation(null);
    } finally {
      setImportValidateBusy(false);
    }
  }, [importParsed, importSourceLabel]);

  const runCommitImport = useCallback(async () => {
    if (!importParsed?.devices.length || !importValidation?.ok) return;
    setImportCommitBusy(true);
    setErr(null);
    setOk(null);
    try {
      const rows = importParsed.devices.map((d) => deviceCsvRowToImportApiRow(d));
      const res = await commitDeviceImportRows(rows, importSourceLabel);
      if (!res) {
        setErr("Import returned no data.");
        return;
      }
      await loadDevices(appliedQ);
      setImportModalOpen(false);
      setImportCsvText("");
      setImportSourceLabel(null);
      setImportParsed(null);
      setImportValidation(null);
      const audit = `Audit ${res.audit_id.slice(0, 8)}…`;
      if (res.status === "succeeded") {
        setOk(`${audit}: imported ${res.success_count} device(s).`);
      } else if (res.status === "partial") {
        setOk(`${audit}: imported ${res.success_count} of ${res.row_count}.`);
        setErr((res.failures ?? []).map((f) => `Line ${f.line}: ${f.message}`).join("\n"));
      } else {
        setErr(
          (res.failures ?? []).length
            ? `${audit}: import failed.\n${(res.failures ?? []).map((f) => `Line ${f.line}: ${f.message}`).join("\n")}`
            : `${audit}: import failed.`,
        );
      }
    } catch (e) {
      setErr(isApiHttpError(e) ? e.message : e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImportCommitBusy(false);
    }
  }, [appliedQ, importParsed, importSourceLabel, importValidation, loadDevices]);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setSaving(false);
    setDeviceModalTab("identity");
    setIcon("");
    setExpectedInterval("");
    setLateThreshold("");
    setOfflineThreshold("");
    setFirmwareVersion("");
    setFirmwareChannel("");
    setOtaSupported(false);
    setRollbackSupported(false);
  }, []);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  useEffect(() => {
    void loadDevices(appliedQ);
  }, [appliedQ, loadDevices, location.pathname, location.hash]);

  const timeScopedItems = useMemo(() => {
    return items.filter((d) => matchesTimeScope(d, timeScope));
  }, [items, timeScope]);

  const protocolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of items) {
      const pb = protocolBucket(d);
      if (pb) set.add(pb);
    }
    return Array.from(set).sort();
  }, [items]);

  const dropdownFiltered = useMemo(() => {
    return timeScopedItems.filter((d) => {
      if (filterStatus !== "all" && livenessBucket(d) !== filterStatus) return false;
      if (filterActivation !== "all" && activationBucket(d) !== filterActivation) return false;
      if (filterConnectivity !== "all" && connectivityBucket(d) !== filterConnectivity) return false;
      if (filterProtocol !== "all") {
        const pb = protocolBucket(d);
        if (filterProtocol === PROTOCOL_FILTER_NONE) {
          if (pb !== "") return false;
        } else if (pb !== filterProtocol) return false;
      }
      return true;
    });
  }, [timeScopedItems, filterStatus, filterActivation, filterConnectivity, filterProtocol]);

  const kpiStats = useMemo(() => {
    const rows = timeScopedItems;
    const total = rows.length;
    let online = 0;
    let degraded = 0;
    let offline = 0;
    let error = 0;
    for (const d of rows) {
      switch (kpiBucket(d)) {
        case "online":
          online++;
          break;
        case "degraded":
          degraded++;
          break;
        case "offline":
          offline++;
          break;
        case "error":
          error++;
          break;
        default:
          break;
      }
    }
    const siteIds = new Set(rows.map((r) => r.site_id));
    let latest: { iso: string; name: string } | null = null;
    let bestMs = -1;
    for (const d of rows) {
      const ms = lastDataReceivedMs(d);
      if (ms !== null && ms > bestMs) {
        bestMs = ms;
        latest = { iso: new Date(ms).toISOString(), name: d.name };
      }
    }
    const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");
    return {
      total,
      online,
      degraded,
      offline,
      error,
      siteCount: siteIds.size,
      pctOnline: pct(online),
      pctDegraded: pct(degraded),
      pctOffline: pct(offline),
      pctError: pct(error),
      lastRelative: latest ? formatRelativeShort(latest.iso) : "—",
      lastDeviceName: latest?.name ?? "",
    };
  }, [timeScopedItems]);

  const versionDrawerDevice = useMemo(() => {
    if (!versionDrawerDeviceId) return null;
    return items.find((x) => x.id === versionDrawerDeviceId) ?? versionDrawerFetched;
  }, [items, versionDrawerDeviceId, versionDrawerFetched]);

  const editDeviceSnapshot = useMemo(
    () => (modalMode === "edit" && editId ? items.find((x) => x.id === editId) ?? null : null),
    [modalMode, editId, items],
  );

  useEffect(() => {
    if (!versionDrawerDeviceId) {
      setVersionDrawerFetched(null);
      return;
    }
    if (items.some((d) => d.id === versionDrawerDeviceId)) {
      setVersionDrawerFetched(null);
      return;
    }
    const idToFetch = versionDrawerDeviceId;
    let cancelled = false;
    void getDevice(idToFetch)
      .then((d) => {
        if (!cancelled) setVersionDrawerFetched(d);
      })
      .catch(() => {
        if (!cancelled) {
          setVersionDrawerFetched(null);
          setVersionDrawerDeviceId(null);
          const next = new URLSearchParams(searchParams);
          if (next.get("device") === idToFetch && next.get("versionHistory") === "1") {
            next.delete("device");
            next.delete("versionHistory");
            setSearchParams(next, { replace: true });
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [versionDrawerDeviceId, items, searchParams, setSearchParams]);

  useEffect(() => {
    const id = searchParams.get("device")?.trim();
    if (!id || searchParams.get("versionHistory") !== "1") return;
    setVersionDrawerDeviceId(id);
  }, [searchParams]);

  const closeVersionHistoryDrawer = useCallback(() => {
    setVersionDrawerDeviceId(null);
    const next = new URLSearchParams(searchParams);
    if (next.get("versionHistory") === "1") {
      next.delete("versionHistory");
      next.delete("device");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const dropdownFilterActive = useMemo(() => {
    return (
      filterStatus !== "all" ||
      filterActivation !== "all" ||
      filterConnectivity !== "all" ||
      filterProtocol !== "all"
    );
  }, [filterStatus, filterActivation, filterConnectivity, filterProtocol]);

  const [deviceTablePage, setDeviceTablePage] = useState(1);

  const deviceTableTotalPages = Math.max(1, Math.ceil(dropdownFiltered.length / DEVICE_TABLE_PAGE_SIZE));

  useEffect(() => {
    setDeviceTablePage((p) => Math.min(p, deviceTableTotalPages));
  }, [deviceTableTotalPages]);

  const deviceTablePageRows = useMemo(() => {
    const start = (deviceTablePage - 1) * DEVICE_TABLE_PAGE_SIZE;
    return dropdownFiltered.slice(start, start + DEVICE_TABLE_PAGE_SIZE);
  }, [dropdownFiltered, deviceTablePage]);

  useEffect(() => {
    setDeviceTablePage(1);
  }, [appliedQ, filterStatus, filterActivation, filterConnectivity, filterProtocol, timeScope, opsSiteId]);

  useEffect(() => {
    if (refreshToken === 0) return;
    void loadDevices(appliedQ);
  }, [refreshToken, loadDevices, appliedQ]);

  useEffect(() => {
    if (!location.hash || location.hash !== "#registered-devices-table") return;
    window.requestAnimationFrame(() => {
      document.getElementById("registered-devices-table")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, [location.hash, location.pathname, items.length]);

  useEffect(() => {
    if (modalMode !== "create" && modalMode !== "edit") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalMode, closeModal]);

  useEffect(() => {
    if (modalMode === "create" && !siteId && sites.length > 0) {
      setSiteId(sites[0].id);
    }
  }, [modalMode, siteId, sites]);

  const openCreateModal = useCallback(() => {
    setErr(null);
    setOk(null);
    setEditId(null);
    setName("");
    setDescription("");
    setSiteId(sites[0]?.id ?? "");
    setDeviceModalTab("identity");
    setIcon("");
    setExpectedInterval("");
    setLateThreshold("");
    setOfflineThreshold("");
    setFirmwareVersion("");
    setFirmwareChannel("");
    setOtaSupported(false);
    setRollbackSupported(false);
    setModalMode("create");
  }, [sites]);

  const openEditModal = useCallback((d: DeviceRead) => {
    setErr(null);
    setOk(null);
    setEditId(d.id);
    setName(d.name);
    setDescription(d.description ?? "");
    setSiteId(d.site_id);
    setDeviceModalTab("identity");
    setIcon(d.icon ?? "");
    setExpectedInterval(d.expected_interval_seconds != null ? String(d.expected_interval_seconds) : "");
    setLateThreshold(d.late_threshold_seconds != null ? String(d.late_threshold_seconds) : "");
    setOfflineThreshold(d.offline_threshold_seconds != null ? String(d.offline_threshold_seconds) : "");
    setFirmwareVersion(d.firmware_version?.trim() ?? "");
    const ch = (d.firmware_channel ?? "").trim().toLowerCase();
    if (ch === "stable" || ch === "beta" || ch === "dev" || ch === "custom") {
      setFirmwareChannel(ch);
    } else {
      setFirmwareChannel("");
    }
    setOtaSupported(Boolean(d.ota_supported));
    setRollbackSupported(Boolean(d.rollback_supported));
    setModalMode("edit");
  }, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(searchInput);
  }

  function clearFilters() {
    setFilterStatus("all");
    setFilterActivation("all");
    setFilterConnectivity("all");
    setFilterProtocol("all");
    setSearchInput("");
    setAppliedQ("");
  }

  function formatOptionalTs(iso: string | null | undefined): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return String(iso);
    }
  }

  function lastDataSummary(d: DeviceRead): string {
    const ms = lastDataReceivedMs(d);
    if (ms === null) return "—";
    return formatOptionalTs(new Date(ms).toISOString());
  }

  function protocolLabel(d: DeviceRead): string {
    const p = d.endpoint?.protocol;
    if (!p || !String(p).trim()) return "—";
    const n = normalizeProtocol(p);
    if (n === "http") return "HTTP / REST";
    if (n === "websocket") return "WebSocket";
    return n.toUpperCase();
  }

  async function checkConnectivityForListedDevices() {
    const withEndpoint = items.filter((d) => d.endpoint);
    if (withEndpoint.length === 0) {
      setOk(null);
      setErr("No devices in this list have a saved endpoint. Open Manage device to save configuration first.");
      return;
    }
    setCheckingConnectivity(true);
    setErr(null);
    setOk(null);
    let failures = 0;
    for (const d of withEndpoint) {
      try {
        await validateDeviceEndpoint(d.id);
      } catch {
        failures += 1;
      }
    }
    await loadDevices(appliedQ);
    setCheckingConnectivity(false);
    if (failures > 0) {
      setErr(
        `Connectivity re-check finished with ${failures} failure(s) (${withEndpoint.length - failures} succeeded). The table was refreshed; hover Connectivity for API detail where available.`,
      );
      setOk(null);
    } else {
      setOk(`Connectivity checked for ${withEndpoint.length} device(s).`);
    }
  }

  async function onModalSubmit(e: FormEvent) {
    e.preventDefault();
    if (!siteId || !name.trim()) return;
    const lateN = parseOptionalPositiveInt(lateThreshold);
    const offN = parseOptionalPositiveInt(offlineThreshold);
    if (lateN !== undefined && offN !== undefined && offN < lateN) {
      setErr("Offline threshold must be greater than or equal to late threshold.");
      return;
    }
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const iconTrim = icon.trim();
      const expN = parseOptionalPositiveInt(expectedInterval);
      const meta = {
        icon: iconTrim ? iconTrim : null,
        expected_interval_seconds: expN ?? null,
        late_threshold_seconds: lateN ?? null,
        offline_threshold_seconds: offN ?? null,
        firmware_version: firmwareVersion.trim() ? firmwareVersion.trim() : null,
        firmware_channel: firmwareChannel ? firmwareChannel : null,
        ota_supported: otaSupported,
        rollback_supported: rollbackSupported,
      };
      if (modalMode === "create") {
        await createDevice({
          name: name.trim(),
          description: description.trim() || null,
          site_id: siteId,
          ...meta,
        });
        setOk("Device registered.");
      } else if (modalMode === "edit" && editId) {
        await updateDevice(editId, {
          name: name.trim(),
          description: description.trim() || null,
          site_id: siteId,
          ...meta,
        });
        setOk("Device updated.");
      }
      closeModal();
      await loadDevices(appliedQ);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  const canClearFilters = dropdownFilterActive || !!searchInput.trim() || !!appliedQ.trim();

  const rowImportValidationMessage = (line: number) => {
    const pe = importParsed?.rowParseErrors.find((r) => r.line === line)?.message;
    const ve = importValidation?.row_errors.find((r) => r.line === line)?.message;
    const parts = [pe, ve].filter(Boolean);
    return parts.length ? parts.join(" · ") : "—";
  };

  return (
    <PageShell variant="list" className="device-manage-page">
      <div className="dm-root">
        <OpsPageHeader
          title="Manage Devices"
          subtitle="View and manage all devices across your sites."
          actions={
            <>
              <button
                type="button"
                className="dm-btn dm-btn--outline"
                onClick={() => setOtaListOpen(true)}
                title="View OTA campaigns in a modal (same as Devices → OTA)"
              >
                OTA Campaigns
              </button>
              <Link to="/devices/lineage" className="dm-btn dm-btn--outline">
                Operational Lineage
              </Link>
              {canDevicesImport ? (
                <button
                  type="button"
                  className="dm-btn dm-btn--outline"
                  disabled={sites.length === 0}
                  title={
                    sites.length === 0
                      ? "Load sites before importing."
                      : "Import devices from CSV: paste or upload, validate, then save."
                  }
                  onClick={openImportModal}
                >
                  <Upload size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                  Import Devices
                </button>
              ) : null}
              <button
                type="button"
                className="dm-btn dm-btn--outline"
                disabled={dropdownFiltered.length === 0 || tableLoading}
                onClick={() => exportDevicesCsv(dropdownFiltered, sitesById)}
              >
                <Download size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                Export
              </button>
              <button
                type="button"
                className="dm-btn dm-btn--outline"
                disabled={checkingConnectivity || tableLoading || items.length === 0}
                title="Re-run endpoint validation for each device that has a saved endpoint, then reload the table."
                onClick={() => void checkConnectivityForListedDevices()}
              >
                <AppIcon name="refresh" size="table" aria-hidden />
                {checkingConnectivity ? "Checking…" : "Validate Endpoints"}
              </button>
              <button type="button" className="dm-btn dm-btn--primary" onClick={openCreateModal} disabled={!canDevicesWrite} title={!canDevicesWrite ? "Requires devices.write" : undefined}>
                Register New Device
              </button>
            </>
          }
        />

        <OpsKpiRow ariaLabel="Device summary">
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="device" size="card" className="dm-kpi__label-icon" aria-hidden />
                Total devices
              </div>
              <div className="dm-kpi__value">{kpiStats.total}</div>
              <div className="dm-kpi__sub">
                Across {kpiStats.siteCount} site{kpiStats.siteCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
              <AppIcon name="device" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="online" size="card" aria-hidden />
                Online
              </div>
              <div className="dm-kpi__value">{kpiStats.online}</div>
              <div className="dm-kpi__sub">{kpiStats.pctOnline}%</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--online" aria-hidden>
              <AppIcon name="online" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="degraded" size="card" aria-hidden />
                Degraded
              </div>
              <div className="dm-kpi__value">{kpiStats.degraded}</div>
              <div className="dm-kpi__sub">{kpiStats.pctDegraded}%</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--warn" aria-hidden>
              <AppIcon name="degraded" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="offline" size="card" aria-hidden />
                Offline
              </div>
              <div className="dm-kpi__value">{kpiStats.offline}</div>
              <div className="dm-kpi__sub">{kpiStats.pctOffline}%</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--offline" aria-hidden>
              <AppIcon name="offline" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="alert" size="card" aria-hidden />
                Error
              </div>
              <div className="dm-kpi__value">{kpiStats.error}</div>
              <div className="dm-kpi__sub">{kpiStats.pctError}%</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--error" aria-hidden>
              <AppIcon name="alert" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="refresh" size="card" className="dm-kpi__label-icon" aria-hidden />
                Last data received
              </div>
              <div className="dm-kpi__value">{kpiStats.lastRelative}</div>
              <div className="dm-kpi__sub">{kpiStats.lastDeviceName ? `Latest: ${kpiStats.lastDeviceName}` : "No recent payloads"}</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
              <AppIcon name="refresh" size="card" aria-hidden />
            </div>
          </div>
        </OpsKpiRow>

        <OpsFilterPanel ariaLabel="Search and filters">
          <form className="dm-controls-form" onSubmit={onSearch}>
            <div className="dm-controls-form__row">
              <OpsScopeControls variant="filters" timeRangeLabel="Range" />
              <div className="dm-search-wrap">
                <Search size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                <input
                  className="dm-search-input"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by name, description, protocol..."
                  aria-label="Search devices"
                />
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dm-f-status">Status</label>
                <select id="dm-f-status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">All statuses</option>
                  {HIDE_STATUS_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dm-f-act">Activation</label>
                <select id="dm-f-act" value={filterActivation} onChange={(e) => setFilterActivation(e.target.value)}>
                  <option value="all">All</option>
                  {HIDE_ACTIVATION_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dm-f-conn">Connectivity</label>
                <select id="dm-f-conn" value={filterConnectivity} onChange={(e) => setFilterConnectivity(e.target.value)}>
                  <option value="all">All</option>
                  {HIDE_CONNECTIVITY_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dm-f-proto">Protocol</label>
                <select id="dm-f-proto" value={filterProtocol} onChange={(e) => setFilterProtocol(e.target.value)}>
                  <option value="all">All</option>
                  <option value={PROTOCOL_FILTER_NONE}>No protocol</option>
                  {protocolOptions.map((pb) => (
                    <option key={pb} value={pb}>
                      {protocolFilterLabel(pb)}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="dm-clear-filters" disabled={!canClearFilters} onClick={clearFilters}>
                Clear filters
              </button>
              <button type="submit" className="dm-btn dm-btn--primary dm-btn--search" disabled={tableLoading}>
                Search
              </button>
            </div>
          </form>
        </OpsFilterPanel>

        {dropdownFilterActive && dropdownFiltered.length > 0 ? (
          <p className="dm-inline-summary">
            Showing <strong>{dropdownFiltered.length}</strong> of <strong>{timeScopedItems.length}</strong> device
            {timeScopedItems.length === 1 ? "" : "s"} matching the shell time range (devices with no ingest yet stay listed).
          </p>
        ) : null}

        <OpsDataTable id="registered-devices-table">
          {loading && items.length === 0 ? (
            <p className="dm-empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="dm-data-table__empty">No registered devices match the current filters.</p>
          ) : timeScopedItems.length === 0 ? (
            <p className="dm-empty">No device activity in the selected time range. Try widening the time range or clearing filters.</p>
          ) : dropdownFiltered.length === 0 ? (
            <p className="dm-empty">No devices match the selected filters. Adjust the dropdowns or clear filters.</p>
          ) : (
            <div className="dm-device-table-shell" aria-busy={tableLoading}>
              {tableLoading ? <p className="dm-table-loading">Updating list…</p> : null}
              <div className="dm-table-scroll">
                <table className="dm-data-table">
                  <thead>
                    <tr>
                      <th className="dm-data-table__th" scope="col">
                        Name
                      </th>
                      <th className="dm-data-table__th" scope="col">
                        Site
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--desc" scope="col">
                        Description
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--version" scope="col" title="Firmware Version">
                        Firmware Version
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--version" scope="col" title="Firmware channel">
                        Channel
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--center dm-data-table__th--version" scope="col">
                        OTA
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--center dm-data-table__th--version" scope="col">
                        Rollback
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--version" scope="col" title="Device version">
                        Dev. version
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--version" scope="col">
                        Ver. status
                      </th>
                      <th className="dm-data-table__th" scope="col">
                        Protocol
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                        Activation
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                        Connectivity
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                        Status
                      </th>
                      {SHOW_DEVICE_OPERATIONAL_FOOTPRINT_COLUMN ? (
                        <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                          Operational
                        </th>
                      ) : null}
                      <th className="dm-data-table__th" scope="col">
                        Last data
                      </th>
                      <th className="dm-data-table__th dm-data-table__th--actions" scope="col">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceTablePageRows.map((d) => {
                      const siteLabel = sitesById[d.site_id] ?? `${d.site_id.slice(0, 8)}…`;
                      const kind = statusDotKind(d);
                      return (
                        <tr key={d.id} className="dm-data-table__row">
                          <td className="dm-data-table__td">
                            <Link className="dm-name-link" to={`/devices/manage?device=${encodeURIComponent(d.id)}`}>
                              {d.name}
                            </Link>
                          </td>
                          <td className="dm-data-table__td">
                            <small>{siteLabel}</small>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--desc">
                            <span title={d.description ?? undefined} style={tdDesc}>
                              {d.description?.trim() ? d.description : "—"}
                            </span>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--version">
                            <button
                              type="button"
                              className="dm-version-link"
                              title="Open version history"
                              onClick={() => setVersionDrawerDeviceId(d.id)}
                            >
                              {d.firmware_version?.trim() ? d.firmware_version.trim() : "—"}
                            </button>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--version">
                            {(() => {
                              const ch = normalizeFirmwareChannel(d.firmware_channel);
                              return (
                                <span
                                  className={`dm-version-pill dm-version-pill--channel-${firmwareChannelPillSuffix(ch)}`}
                                  title={formatFirmwareChannelLabel(ch)}
                                >
                                  {formatFirmwareChannelLabel(ch)}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center dm-data-table__td--version">
                            <DeviceBoolPill value={Boolean(d.ota_supported)} />
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center dm-data-table__td--version">
                            <DeviceBoolPill value={Boolean(d.rollback_supported)} />
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--version">
                            <button
                              type="button"
                              className="dm-version-link"
                              title="Open version history"
                              onClick={() => setVersionDrawerDeviceId(d.id)}
                            >
                              {d.device_version ?? "1"}
                            </button>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--version">
                            {(() => {
                              const st = normalizeVersionStatus(d.version_status);
                              return (
                                <span
                                  className={`dm-version-pill dm-version-pill--status-${versionStatusPillSuffix(st)}`}
                                  title={formatVersionStatusLabel(st)}
                                >
                                  {formatVersionStatusLabel(st)}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="dm-data-table__td">{protocolLabel(d)}</td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            {d.endpoint?.activation_status ? (
                              <OpsStatusPill
                                status={d.endpoint.activation_status}
                                variant={activationPillVariant(d.endpoint.activation_status)}
                              />
                            ) : (
                              <OpsStatusPill status="—" variant="muted" />
                            )}
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            <span title={connectivityTitle(d)}>
                              <OpsStatusPill status={connectivityStatusKey(d)} variant={connectivityPillVariant(d)} />
                            </span>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            <OpsStatusPill status={compositeDeviceStatusKey(d)} variant={kind} />
                          </td>
                          {SHOW_DEVICE_OPERATIONAL_FOOTPRINT_COLUMN ? (
                            <td className="dm-data-table__td dm-data-table__td--center">
                              <span title={d.footprint_recommendation_message ?? undefined}>
                                {d.footprint_operational_status?.trim() ? (
                                  <OpsStatusPill
                                    status={d.footprint_operational_status}
                                    variant={footprintOperationalPillVariant(d.footprint_operational_status)}
                                  />
                                ) : (
                                  <OpsStatusPill status="—" variant="muted" />
                                )}
                              </span>
                            </td>
                          ) : null}
                          <td className="dm-data-table__td dm-data-table__td--muted">{lastDataSummary(d)}</td>
                          <td className="dm-data-table__td dm-data-table__td--actions">
                            <div className="dm-act-grid">
                              <OpsActionButton tone="plain" title="Edit device info" aria-label={`Edit registration for ${d.name}`} onClick={() => openEditModal(d)}>
                                <Pencil size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </OpsActionButton>
                              <Link
                                className="dm-act-grid__btn"
                                to={deviceDetailsUrl(d.id)}
                                title="Device details — versions, lineage, impact, OTA"
                                aria-label={`Device details hub for ${d.name}`}
                              >
                                <LayoutList size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </Link>
                              <Link
                                className="dm-act-grid__btn"
                                to={`/devices/manage?device=${encodeURIComponent(d.id)}`}
                                title="Endpoint configuration — Manage device"
                                aria-label={`Endpoint configuration for ${d.name}`}
                              >
                                <Settings2 size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </Link>
                              <OpsActionButton
                                tone="plain"
                                title="View last sample payload (raw archives)"
                                aria-label={`View raw sample for ${d.name}`}
                                onClick={() => openRawSampleModal(d)}
                              >
                                <FileJson2 size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </OpsActionButton>
                              <OpsActionButton
                                tone="plain"
                                title={!canOtaCreate ? "Requires ota.create" : "New OTA Campaign — site prefilled from this device"}
                                aria-label={`New OTA Campaign for site of ${d.name}`}
                                disabled={!canOtaCreate}
                                onClick={() => {
                                  setOtaWizardSiteId(d.site_id);
                                  setOtaWizardDeviceId(d.id);
                                  setOtaWizardDeviceName(d.name);
                                  setOtaWizardSiteName(sitesById[d.site_id] ?? d.site_id);
                                  setOtaNewOpen(true);
                                }}
                              >
                                <Rocket size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </OpsActionButton>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {deviceTableTotalPages > 1 ? (
                <div className="dm-table-pager" role="navigation" aria-label="Device table pages">
                  <span className="dm-table-pager__range">
                    {(deviceTablePage - 1) * DEVICE_TABLE_PAGE_SIZE + 1}–
                    {Math.min(dropdownFiltered.length, deviceTablePage * DEVICE_TABLE_PAGE_SIZE)} of {dropdownFiltered.length}
                  </span>
                  <div className="dm-table-pager__controls">
                    <button
                      type="button"
                      className="dm-act-grid__btn dm-act-grid__btn--text"
                      disabled={deviceTablePage <= 1}
                      onClick={() => setDeviceTablePage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={16} aria-hidden />
                      Prev
                    </button>
                    <span className="dm-table-pager__page">
                      Page {deviceTablePage} / {deviceTableTotalPages}
                    </span>
                    <button
                      type="button"
                      className="dm-act-grid__btn dm-act-grid__btn--text"
                      disabled={deviceTablePage >= deviceTableTotalPages}
                      onClick={() => setDeviceTablePage((p) => Math.min(deviceTableTotalPages, p + 1))}
                    >
                      Next
                      <ChevronRight size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </OpsDataTable>
      </div>

      <AppModalShell
        open={importModalOpen}
        onClose={closeImportModal}
        title="Import devices from CSV"
        titleId="device-import-modal-title"
        subtitle={
          importSourceLabel
            ? `Source: ${importSourceLabel} — edit rows below before validating.`
            : "Paste CSV or choose a file, parse, then edit rows before validate and import."
        }
        size="xl"
        dialogClassName="ingest-ept-endpoint-dialog device-import-csv-dialog"
      >
        <div className="device-import-modal-root device-manage-page ingest-ept-page">
          <fieldset className="ingest-ept-fieldset">
            <legend>CSV input</legend>
            <textarea
              className="dm-search-input device-import-modal__textarea"
              value={importCsvText}
              onChange={(e) => {
                setImportCsvText(e.target.value);
                setImportValidation(null);
              }}
              rows={10}
              spellCheck={false}
              placeholder={'name,site,description\n"My Device","Main Site","Optional desc"'}
              aria-label="CSV content"
            />
            <div className="ingest-ept-actions">
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="dm-sr-only"
                tabIndex={-1}
                onChange={(e) => void onModalImportFileChange(e)}
              />
              <AarButton type="button" variant="outline" disabled={importValidateBusy || importCommitBusy} onClick={() => importFileInputRef.current?.click()}>
                Choose file…
              </AarButton>
              <AarButton type="button" variant="outline" disabled={importValidateBusy || importCommitBusy || !importCsvText.trim()} onClick={runParsePreview}>
                Parse & preview
              </AarButton>
            </div>
          </fieldset>

          {(importParsed?.parseErrors ?? []).some((m) => !m.startsWith("Line ")) ? (
            <div className="device-register-page__import-parse-errors" role="alert">
              <strong>CSV structure</strong>
              <ul className="device-register-page__import-error-list">
                {(importParsed?.parseErrors ?? [])
                  .filter((m) => !m.startsWith("Line "))
                  .map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
              </ul>
            </div>
          ) : null}

          {importParsed && importParsed.devices.length > 0 ? (
            <fieldset className="ingest-ept-fieldset">
              <legend>Edit before import ({importParsed.devices.length} row{importParsed.devices.length === 1 ? "" : "s"})</legend>
              <div className="device-import-modal__table-wrap dm-table-scroll">
                <table className="dm-data-table device-register-page__import-preview-table device-register-page__import-edit-table">
                  <thead>
                    <tr>
                      <th className="dm-data-table__th">Line</th>
                      <th className="dm-data-table__th">Site</th>
                      <th className="dm-data-table__th">Name</th>
                      <th className="dm-data-table__th">Description</th>
                      <th className="dm-data-table__th">Icon</th>
                      <th className="dm-data-table__th">Active</th>
                      <th className="dm-data-table__th">Poll</th>
                      <th className="dm-data-table__th" title="expected_interval_seconds">
                        Int (s)
                      </th>
                      <th className="dm-data-table__th" title="late_threshold_seconds">
                        Late
                      </th>
                      <th className="dm-data-table__th" title="offline_threshold_seconds">
                        Off
                      </th>
                      <th className="dm-data-table__th">Firmware Version</th>
                      <th className="dm-data-table__th">Channel</th>
                      <th className="dm-data-table__th">OTA</th>
                      <th className="dm-data-table__th">Rb</th>
                      <th className="dm-data-table__th">Dev ver</th>
                      <th className="dm-data-table__th">Status</th>
                      <th className="dm-data-table__th">Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importParsed.devices.map((d) => (
                      <tr key={d.line}>
                        <td className="dm-data-table__td">{d.line}</td>
                        <td className="dm-data-table__td">
                          <select
                            className="device-import-modal__cell-input device-import-modal__cell-input--site"
                            value={d.site_id}
                            onChange={(e) => patchImportRow(d.line, { site_id: e.target.value })}
                            aria-label={`Site for line ${d.line}`}
                          >
                            {sites.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            className="device-import-modal__cell-input device-import-modal__cell-input--name"
                            value={d.name}
                            onChange={(e) => patchImportRow(d.line, { name: e.target.value })}
                            aria-label={`Name line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            className="device-import-modal__cell-input device-import-modal__cell-input--wide"
                            value={d.description}
                            onChange={(e) => patchImportRow(d.line, { description: e.target.value })}
                            aria-label={`Description line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            className="device-import-modal__cell-input"
                            value={d.icon}
                            onChange={(e) => patchImportRow(d.line, { icon: e.target.value })}
                            aria-label={`Icon line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <input
                            type="checkbox"
                            checked={d.is_active}
                            onChange={(e) => patchImportRow(d.line, { is_active: e.target.checked })}
                            aria-label={`Active line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <input
                            type="checkbox"
                            checked={d.polling_enabled}
                            onChange={(e) => patchImportRow(d.line, { polling_enabled: e.target.checked })}
                            aria-label={`Polling line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            type="number"
                            className="device-import-modal__cell-input"
                            min={5}
                            max={86400}
                            placeholder="60"
                            value={d.expected_interval_seconds ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") {
                                patchImportRow(d.line, { expected_interval_seconds: null });
                                return;
                              }
                              const n = Number.parseInt(raw, 10);
                              if (Number.isFinite(n)) patchImportRow(d.line, { expected_interval_seconds: n });
                            }}
                            aria-label={`Expected interval line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            type="number"
                            className="device-import-modal__cell-input"
                            min={1}
                            max={86400}
                            placeholder="120"
                            value={d.late_threshold_seconds ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") {
                                patchImportRow(d.line, { late_threshold_seconds: null });
                                return;
                              }
                              const n = Number.parseInt(raw, 10);
                              if (Number.isFinite(n)) patchImportRow(d.line, { late_threshold_seconds: n });
                            }}
                            aria-label={`Late threshold line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            type="number"
                            className="device-import-modal__cell-input"
                            min={1}
                            max={86400}
                            placeholder="300"
                            value={d.offline_threshold_seconds ?? ""}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") {
                                patchImportRow(d.line, { offline_threshold_seconds: null });
                                return;
                              }
                              const n = Number.parseInt(raw, 10);
                              if (Number.isFinite(n)) patchImportRow(d.line, { offline_threshold_seconds: n });
                            }}
                            aria-label={`Offline threshold line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            className="device-import-modal__cell-input"
                            value={d.firmware_version}
                            onChange={(e) => patchImportRow(d.line, { firmware_version: e.target.value })}
                            aria-label={`Firmware version line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <select
                            className="device-import-modal__cell-input device-import-modal__cell-input--channel"
                            value={d.firmware_channel || ""}
                            onChange={(e) => patchImportRow(d.line, { firmware_channel: e.target.value })}
                            aria-label={`Firmware channel line ${d.line}`}
                          >
                            <option value="">default (stable)</option>
                            <option value="stable">stable</option>
                            <option value="beta">beta</option>
                            <option value="dev">dev</option>
                            <option value="custom">custom</option>
                          </select>
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <input
                            type="checkbox"
                            checked={d.ota_supported}
                            onChange={(e) => patchImportRow(d.line, { ota_supported: e.target.checked })}
                            aria-label={`OTA supported line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <input
                            type="checkbox"
                            checked={d.rollback_supported}
                            onChange={(e) => patchImportRow(d.line, { rollback_supported: e.target.checked })}
                            aria-label={`Rollback supported line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <input
                            className="device-import-modal__cell-input"
                            placeholder="1"
                            value={d.device_version}
                            onChange={(e) => patchImportRow(d.line, { device_version: e.target.value })}
                            aria-label={`Device version line ${d.line}`}
                          />
                        </td>
                        <td className="dm-data-table__td">
                          <select
                            className="device-import-modal__cell-input device-import-modal__cell-input--status"
                            value={d.version_status || ""}
                            onChange={(e) => patchImportRow(d.line, { version_status: e.target.value })}
                            aria-label={`Version status line ${d.line}`}
                          >
                            <option value="">default (active)</option>
                            <option value="active">active</option>
                            <option value="candidate">candidate</option>
                            <option value="pending">pending</option>
                            <option value="breaking">breaking</option>
                            <option value="rolled_back">rolled_back</option>
                          </select>
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--muted" title={rowImportValidationMessage(d.line)}>
                          {rowImportValidationMessage(d.line)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
          ) : null}

          <div className="ingest-ept-actions ingest-ept-actions--modal-footer">
            <AarButton type="button" variant="outline" disabled={importValidateBusy || importCommitBusy} onClick={closeImportModal}>
              Cancel
            </AarButton>
            <AarButton
              type="button"
              variant="outline"
              disabled={importValidateBusy || importCommitBusy || !importParsed?.devices.length}
              onClick={() => void runValidateImport()}
            >
              {importValidateBusy ? "Validating…" : "Validate"}
            </AarButton>
            <AarButton
              type="button"
              variant="primary"
              disabled={
                importValidateBusy ||
                importCommitBusy ||
                !importParsed?.devices.length ||
                !importValidation?.ok
              }
              onClick={() => void runCommitImport()}
            >
              {importCommitBusy ? "Importing…" : "Save and begin import"}
            </AarButton>
          </div>
        </div>
      </AppModalShell>

      <AppModalShell
        open={Boolean(modalMode)}
        onClose={closeModal}
        title={modalMode === "create" ? "Register device" : "Edit device"}
        titleId="device-modal-title"
        size="lg"
      >
        <form onSubmit={onModalSubmit}>
          <div style={modalStack}>
            <AppTabs<DeviceRegModalTab>
              tabs={[
                { id: "identity", label: "Identity" },
                { id: "readiness", label: "Readiness & firmware" },
              ]}
              active={deviceModalTab}
              onChange={setDeviceModalTab}
              plain
              ariaLabel="Device registration sections"
            />
            {deviceModalTab === "identity" ? (
              <div role="tabpanel" style={{ marginTop: "0.65rem" }}>
                <label style={modalFieldStacked}>
                  Site
                  <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required style={inpFull}>
                    <option value="" disabled>
                      Select site
                    </option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={modalFieldStacked}>
                  Device name
                  <input value={name} onChange={(e) => setName(e.target.value)} required style={inpFull} />
                </label>
                <label style={modalFieldStacked}>
                  Description
                  <input value={description} onChange={(e) => setDescription(e.target.value)} style={inpFull} />
                </label>
                <label style={modalFieldStacked}>
                  Icon (optional URL or key)
                  <input value={icon} onChange={(e) => setIcon(e.target.value)} style={inpFull} placeholder="e.g. device-icon-key" />
                </label>
              </div>
            ) : (
              <div role="tabpanel" style={{ marginTop: "0.65rem" }}>
                <p className="dash-widget__muted" style={{ margin: "0 0 0.65rem", fontSize: "0.78rem", lineHeight: 1.45 }}>
                  Declared readiness and firmware metadata (Phase 1). Empty numeric fields keep platform defaults (60 /
                  120 / 300 seconds). Full version lineage controls follow later milestones.
                </p>
                {editDeviceSnapshot ? (
                  <dl
                    style={{
                      margin: "0 0 0.75rem",
                      display: "grid",
                      gridTemplateColumns: "11rem 1fr",
                      gap: "0.25rem 0.5rem",
                      fontSize: "0.82rem",
                    }}
                  >
                    <dt style={{ color: "var(--color-text-muted)" }}>Device version</dt>
                    <dd style={{ margin: 0 }}>{editDeviceSnapshot.device_version ?? "1"}</dd>
                    <dt style={{ color: "var(--color-text-muted)" }}>Version status</dt>
                    <dd style={{ margin: 0 }}>{formatVersionStatusLabel(normalizeVersionStatus(editDeviceSnapshot.version_status))}</dd>
                  </dl>
                ) : null}
                <label style={modalFieldStacked}>
                  Expected interval (seconds)
                  <input
                    type="number"
                    min={5}
                    max={86400}
                    value={expectedInterval}
                    onChange={(e) => setExpectedInterval(e.target.value)}
                    style={inpFull}
                    placeholder="60"
                  />
                </label>
                <label style={modalFieldStacked}>
                  Late threshold (seconds)
                  <input
                    type="number"
                    min={1}
                    max={86400}
                    value={lateThreshold}
                    onChange={(e) => setLateThreshold(e.target.value)}
                    style={inpFull}
                    placeholder="120"
                  />
                </label>
                <label style={modalFieldStacked}>
                  Offline threshold (seconds)
                  <input
                    type="number"
                    min={1}
                    max={86400}
                    value={offlineThreshold}
                    onChange={(e) => setOfflineThreshold(e.target.value)}
                    style={inpFull}
                    placeholder="300"
                  />
                </label>
                <label style={modalFieldStacked}>
                  Firmware Version
                  <input value={firmwareVersion} onChange={(e) => setFirmwareVersion(e.target.value)} style={inpFull} placeholder="Opaque build label" />
                </label>
                <label style={modalFieldStacked}>
                  Firmware channel
                  <select
                    value={firmwareChannel}
                    onChange={(e) =>
                      setFirmwareChannel(e.target.value as "" | "stable" | "beta" | "dev" | "custom")
                    }
                    style={inpFull}
                  >
                    <option value="">Default (stable)</option>
                    <option value="stable">stable</option>
                    <option value="beta">beta</option>
                    <option value="dev">dev</option>
                    <option value="custom">custom</option>
                  </select>
                </label>
                <label style={{ ...modalFieldStacked, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" checked={otaSupported} onChange={(e) => setOtaSupported(e.target.checked)} />
                  OTA supported
                </label>
                <label style={{ ...modalFieldStacked, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" checked={rollbackSupported} onChange={(e) => setRollbackSupported(e.target.checked)} />
                  Rollback supported
                </label>
              </div>
            )}
            <div style={modalActionsRow}>
              <button type="submit" style={btnPrimary} disabled={saving || !sites.length || !canDevicesWrite} title={!canDevicesWrite ? "Requires devices.write" : undefined}>
                {saving ? "Saving…" : modalMode === "create" ? "Register device" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </AppModalShell>

      <AppModalShell
        open={otaListOpen}
        onClose={() => setOtaListOpen(false)}
        title="OTA Campaigns"
        subtitle="Filter by shell site scope. Open a campaign to manage rollout details."
        titleId="ota-list-from-manage-devices-modal-title"
        size="xl"
        dialogClassName="device-endpoint-config-modal ota-campaigns-list-modal"
      >
        <OtaCampaignsListPanel />
      </AppModalShell>

      <AppModalShell
        open={otaNewOpen}
        onClose={() => {
          setOtaNewOpen(false);
          setOtaWizardSiteId(null);
          setOtaWizardDeviceId(null);
          setOtaWizardDeviceName(null);
          setOtaWizardSiteName(null);
        }}
        title="New OTA Campaign"
        subtitle="Choose a firmware artifact, pick device targets, review, then create the draft and submit or launch when you are ready."
        titleId="ota-new-from-manage-devices-modal-title"
        size="xl"
        dialogClassName="device-endpoint-config-modal ota-campaign-new-modal"
      >
        <div className="ota-campaigns-page device-register-page__ota-wizard-wrap">
          <OtaCampaignNewWizard
            initialSiteId={otaWizardSiteId ?? opsSiteId ?? null}
            contextDeviceId={otaWizardDeviceId}
            contextDeviceName={otaWizardDeviceName ?? undefined}
            contextSiteName={otaWizardSiteName ?? undefined}
            onCancel={() => {
              setOtaNewOpen(false);
              setOtaWizardSiteId(null);
              setOtaWizardDeviceId(null);
              setOtaWizardDeviceName(null);
              setOtaWizardSiteName(null);
            }}
            onSuccess={(id) => {
              setOtaNewOpen(false);
              setOtaWizardSiteId(null);
              setOtaWizardDeviceId(null);
              setOtaWizardDeviceName(null);
              setOtaWizardSiteName(null);
              navigate(`/devices/ota/${encodeURIComponent(id)}`);
            }}
          />
        </div>
      </AppModalShell>

      <DeviceVersionHistoryDrawer
        open={Boolean(versionDrawerDevice)}
        device={versionDrawerDevice}
        siteName={
          versionDrawerDevice
            ? sitesById[versionDrawerDevice.site_id] ?? `${versionDrawerDevice.site_id.slice(0, 8)}…`
            : ""
        }
        onClose={closeVersionHistoryDrawer}
      />

      <ScrubberRawSelectModal
        open={rawSampleOpen && Boolean(rawSampleDeviceId)}
        onClose={closeRawSampleModal}
        deviceId={rawSampleDeviceId}
        deviceName={rawSampleDeviceName}
      />
    </PageShell>
  );
}

const inp: CSSProperties = {
  padding: "0.45rem 0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontSize: "0.88rem",
};

const inpFull: CSSProperties = {
  ...inp,
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: CSSProperties = {
  padding: "0.5rem 0.85rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  fontFamily: "inherit",
  fontWeight: 600,
  fontSize: "0.88rem",
  cursor: "pointer",
};

const tdDesc: CSSProperties = {
  maxWidth: "320px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const modalStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.85rem",
  width: "100%",
};

const modalFieldStacked: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.8rem",
  color: "var(--color-text-muted)",
  width: "100%",
};

const modalActionsRow: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: "0.15rem",
};

