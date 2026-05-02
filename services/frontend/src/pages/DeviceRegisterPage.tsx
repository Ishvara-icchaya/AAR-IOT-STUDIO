import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrushCleaning,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson2,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { validateDeviceEndpoint } from "@/api/deviceEndpoints";
import { createDevice, listDevices, updateDevice, type DeviceRead } from "@/api/devices";
import { useOpsShell, type OpsTimeRange } from "@/contexts/OpsShellContext";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsStatusPill } from "@/components/ops/OpsStatusPill";
import { AarButton } from "@/components/system/AarButton";
import { PageShell } from "@/layouts/PageShell";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import { normalizeProtocol } from "@/lib/deviceEndpointConfig";
import { displayLivenessState, lastDataReceivedMs } from "@/lib/deviceLivenessDisplay";
import { ENDPOINT_ACTIVATION_STATUSES, formatActivationLabel } from "@/lib/endpointActivation";
import { AppIcon, ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

import "./device-register-page.css";

type TimeScope = "all" | "last_1_hour" | "last_24_hours" | "last_7_days" | "last_30_days";

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
    "last_data",
  ];
  const lines = [header.join(",")];
  for (const d of rows) {
    const site = sitesById[d.site_id] ?? d.site_id;
    const proto = d.endpoint?.protocol ? normalizeProtocol(d.endpoint.protocol) : "";
    const act = d.endpoint?.activation_status ?? "";
    const conn = d.endpoint?.validation_status ?? "";
    const live = displayLivenessState(d);
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

/** Endpoint validation / connectivity (from last validate run). */
function connectivityLabel(d: DeviceRead): string {
  if (!d.endpoint) return "No endpoint";
  const v = d.endpoint.validation_status;
  if (!v) return "Not checked";
  if (v === "ok") return "Valid";
  if (v === "warning") return "Degraded";
  if (v === "failed") return "Invalid";
  return v;
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

function activationPillVariant(status: string | undefined): "online" | "degraded" | "offline" | "error" | "muted" {
  if (!status) return "muted";
  if (status === "active") return "online";
  if (status === "error") return "error";
  if (status === "waiting_for_first_payload") return "degraded";
  return "muted";
}

function connectivityPillVariant(d: DeviceRead): "online" | "degraded" | "offline" | "error" | "muted" {
  if (!d.endpoint) return "muted";
  const v = d.endpoint.validation_status;
  if (v === "ok") return "online";
  if (v === "warning") return "degraded";
  if (v === "failed") return "error";
  return "muted";
}

function statusLabel(d: DeviceRead): string {
  if (d.is_active === false) return "Inactive";
  const activation = d.endpoint?.activation_status;
  if (activation === "inactive") return "Inactive";
  if (activation === "error") return "Error";
  return livenessLabel(displayLivenessState(d));
}

function statusDotKind(d: DeviceRead): "online" | "degraded" | "offline" | "error" | "muted" {
  if (d.is_active === false) return "muted";
  const activation = d.endpoint?.activation_status;
  if (activation === "error") return "error";
  if (activation === "inactive") return "muted";
  const live = String(displayLivenessState(d));
  if (live === "inactive") return "muted";
  if (live === "online" || live === "recovered") return "online";
  if (live === "offline") return "offline";
  if (live === "late") return "degraded";
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
  { key: "no_endpoint", label: "No endpoint" },
  { key: "not_checked", label: "Not checked" },
  { key: "ok", label: "Valid" },
  { key: "warning", label: "Degraded" },
  { key: "failed", label: "Invalid" },
  { key: "other", label: "Other" },
];

const DEVICE_TABLE_PAGE_SIZE = 25;

const HIDE_STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: "inactive", label: "Inactive" },
  { key: "waiting_for_first_payload", label: "Waiting first payload" },
  { key: "online", label: "Online" },
  { key: "late", label: "Late" },
  { key: "offline", label: "Offline" },
  { key: "recovered", label: "Recovered" },
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
  const [refreshListBusy, setRefreshListBusy] = useState(false);
  useShellFeedback(err, ok);

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterActivation, setFilterActivation] = useState("all");
  const [filterConnectivity, setFilterConnectivity] = useState("all");
  const [filterProtocol, setFilterProtocol] = useState("all");

  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [siteId, setSiteId] = useState("");

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

  /** Same query as `loadDevices` without clearing global error (used between two list passes in refresh). */
  const fetchDevicesListSilent = useCallback(
    async (q: string): Promise<DeviceRead[]> =>
      listDevices({
        q: q.trim() || undefined,
        site_id: opsSiteId?.trim() || undefined,
      }),
    [opsSiteId],
  );

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setSaving(false);
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
    setModalMode("create");
  }, [sites]);

  const openEditModal = useCallback((d: DeviceRead) => {
    setErr(null);
    setOk(null);
    setEditId(d.id);
    setName(d.name);
    setDescription(d.description ?? "");
    setSiteId(d.site_id);
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

  const refreshListAndStatus = useCallback(async () => {
    setRefreshListBusy(true);
    setTableLoading(true);
    setErr(null);
    setOk(null);
    try {
      let list = await fetchDevicesListSilent(appliedQ);
      setItems(list);
      const withEndpoint = list.filter((d) => d.endpoint);
      let failures = 0;
      for (const d of withEndpoint) {
        try {
          await validateDeviceEndpoint(d.id);
        } catch {
          failures += 1;
        }
      }
      list = await fetchDevicesListSilent(appliedQ);
      setItems(list);
      if (failures > 0) {
        setOk(null);
        setErr(
          `Refresh finished with ${failures} connectivity check failure(s) (${withEndpoint.length - failures} succeeded). The table was updated.`,
        );
      } else if (withEndpoint.length > 0) {
        setOk(`Refreshed ${list.length} device(s) and re-checked connectivity for ${withEndpoint.length} with a saved endpoint.`);
      } else {
        setOk(`Refreshed ${list.length} device(s).`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setTableLoading(false);
      setLoading(false);
      setRefreshListBusy(false);
    }
  }, [appliedQ, fetchDevicesListSilent]);

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
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      if (modalMode === "create") {
        await createDevice({
          name: name.trim(),
          description: description.trim() || null,
          site_id: siteId,
        });
        setOk("Device registered.");
      } else if (modalMode === "edit" && editId) {
        await updateDevice(editId, {
          name: name.trim(),
          description: description.trim() || null,
          site_id: siteId,
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
                disabled={dropdownFiltered.length === 0 || tableLoading || refreshListBusy}
                onClick={() => exportDevicesCsv(dropdownFiltered, sitesById)}
              >
                <Download size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                Export
              </button>
              <button type="button" className="dm-btn dm-btn--primary" onClick={openCreateModal}>
                + Register new device
              </button>
              <AarButton
                variant="outline"
                className="device-register-page__refresh-btn"
                disabled={tableLoading || refreshListBusy}
                title="Reload devices from the server and re-run connectivity validation wherever an endpoint exists."
                aria-busy={refreshListBusy || undefined}
                onClick={() => void refreshListAndStatus()}
              >
                <span className={refreshListBusy ? "device-register-page__refresh-icon device-register-page__refresh-icon--spin" : "device-register-page__refresh-icon"}>
                  <RefreshCw size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                </span>
                {refreshListBusy ? "Refreshing…" : "Refresh list"}
              </AarButton>
              <button
                type="button"
                className="dm-btn dm-btn--outline"
                disabled={checkingConnectivity || tableLoading || refreshListBusy || items.length === 0}
                title="Re-run endpoint validation for each device that has a saved endpoint, then reload the table."
                onClick={() => void checkConnectivityForListedDevices()}
              >
                <AppIcon name="refresh" size="table" aria-hidden />
                {checkingConnectivity ? "Checking…" : "Re-check connectivity"}
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
            <p className="dm-empty">
              No devices match{appliedQ ? ` “${appliedQ}”` : ""}.{" "}
              <button type="button" style={linkBtn} onClick={openCreateModal}>
                Register one
              </button>
            </p>
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
                          <td className="dm-data-table__td">{protocolLabel(d)}</td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            {d.endpoint?.activation_status ? (
                              <OpsStatusPill
                                status={formatActivationLabel(d.endpoint.activation_status)}
                                variant={activationPillVariant(d.endpoint.activation_status)}
                              />
                            ) : (
                              <OpsStatusPill status="—" variant="muted" />
                            )}
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            <span title={connectivityTitle(d)}>
                              <OpsStatusPill status={connectivityLabel(d)} variant={connectivityPillVariant(d)} />
                            </span>
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            <OpsStatusPill status={statusLabel(d)} variant={kind} />
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--muted">{lastDataSummary(d)}</td>
                          <td className="dm-data-table__td dm-data-table__td--actions">
                            <div className="dm-act-grid">
                              <OpsActionButton tone="plain" title="Edit device info" aria-label={`Edit registration for ${d.name}`} onClick={() => openEditModal(d)}>
                                <Pencil size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </OpsActionButton>
                              <Link
                                className="dm-act-grid__btn"
                                to={`/devices/manage?device=${encodeURIComponent(d.id)}`}
                                title="Endpoint configuration — Manage device"
                                aria-label={`Endpoint configuration for ${d.name}`}
                              >
                                <Settings2 size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </Link>
                              <Link
                                className="dm-act-grid__btn"
                                to={`/devices/raw?deviceId=${encodeURIComponent(d.id)}`}
                                title="View last sample payload (raw archives)"
                                aria-label={`View raw sample for ${d.name}`}
                              >
                                <FileJson2 size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                              </Link>
                              {d.endpoint?.activation_status === "active" ? (
                                <Link
                                  className="dm-act-grid__btn"
                                  to={`/scrubber/v2/create?deviceId=${encodeURIComponent(d.id)}&returnTo=${encodeURIComponent("/devices/register#registered-devices-table")}`}
                                  title="Scrubber pipeline (v2)"
                                  aria-label={`Open scrubber pipeline for ${d.name}`}
                                >
                                  <BrushCleaning size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                                </Link>
                              ) : (
                                <OpsActionButton
                                  className="dm-act-grid__btn--disabled"
                                  disabled
                                  title={
                                    d.endpoint
                                      ? "Scrubber pipeline is available when activation status is Active."
                                      : "Save an endpoint and reach Active activation to open the scrubber pipeline from this list."
                                  }
                                  aria-label={`Scrubber pipeline unavailable for ${d.name}`}
                                >
                                  <BrushCleaning size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                                </OpsActionButton>
                              )}
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

      {modalMode ? (
        <div style={modalBackdrop} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
          <div style={modalDialog} role="dialog" aria-modal="true" aria-labelledby="device-modal-title">
            <h2 id="device-modal-title" style={modalTitle}>
              {modalMode === "create" ? "Register device" : "Edit device"}
            </h2>
            <form onSubmit={onModalSubmit}>
              <div style={modalRow}>
                <label style={modalField}>
                  Site
                  <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required style={inp}>
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
                <label style={modalField}>
                  Device name
                  <input value={name} onChange={(e) => setName(e.target.value)} required style={inp} />
                </label>
                <label style={modalField}>
                  Description
                  <input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} />
                </label>
                <button type="submit" style={btnPrimary} disabled={saving || !sites.length}>
                  {saving ? "Saving…" : modalMode === "create" ? "Register device" : "Save changes"}
                </button>
              </div>
              <div style={modalFooter}>
                <button type="button" style={btnSecondary} onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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

const btnSecondary: CSSProperties = {
  padding: "0.5rem 0.85rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
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

const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--color-accent)",
  cursor: "pointer",
  font: "inherit",
  textDecoration: "underline",
};

const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: "1rem",
};

const modalDialog: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  padding: "1.25rem 1.5rem",
  maxWidth: "min(960px, 100%)",
  width: "100%",
  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
};

const modalTitle: CSSProperties = {
  margin: "0 0 1rem",
  fontSize: "1.1rem",
  fontWeight: 600,
};

const modalRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.65rem",
  alignItems: "flex-end",
};

const modalField: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.8rem",
  color: "var(--color-text-muted)",
  flex: "1 1 140px",
  minWidth: "120px",
};

const modalFooter: CSSProperties = {
  marginTop: "1rem",
  display: "flex",
  justifyContent: "flex-end",
  gap: "0.5rem",
};
