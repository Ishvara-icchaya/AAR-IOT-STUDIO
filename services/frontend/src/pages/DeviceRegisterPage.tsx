import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrushCleaning } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { validateDeviceEndpoint } from "@/api/deviceEndpoints";
import { createDevice, listDevices, updateDevice, type DeviceRead } from "@/api/devices";
import { PageStatus } from "@/components/PageStatus";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { PageShell } from "@/layouts/PageShell";
import { normalizeProtocol } from "@/lib/deviceEndpointConfig";
import {
  ENDPOINT_ACTIVATION_STATUSES,
  activationStatusStyle,
  formatActivationLabel,
} from "@/lib/endpointActivation";

type SiteRow = { id: string; name: string };

type ModalMode = "create" | "edit" | null;

function livenessLabel(s: string | null | undefined): string {
  const x = String(s || "waiting_for_first_payload");
  if (x === "waiting_for_first_payload") return "Waiting first payload";
  if (x === "online") return "Online";
  if (x === "late") return "Late";
  if (x === "offline") return "Offline";
  if (x === "recovered") return "Recovered";
  return x;
}

function livenessStyle(s: string | null | undefined): CSSProperties {
  const x = String(s || "waiting_for_first_payload");
  if (x === "online") return { color: "var(--color-success, #2e7d32)", fontWeight: 600 };
  if (x === "late") return { color: "var(--color-warning, #b8860b)", fontWeight: 600 };
  if (x === "offline") return { color: "var(--page-status-error-fg, #c62828)", fontWeight: 700 };
  if (x === "recovered") return { color: "var(--color-accent, #4da3ff)", fontWeight: 600 };
  return { color: "var(--color-text-muted)" };
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

function connectivityStyle(d: DeviceRead): CSSProperties {
  if (!d.endpoint) return { color: "var(--color-text-muted)" };
  const v = d.endpoint.validation_status;
  if (v === "ok") return { color: "var(--color-success, #2e7d32)", fontWeight: 600 };
  if (v === "warning") return { color: "var(--color-warning, #b8860b)", fontWeight: 600 };
  if (v === "failed") return { color: "var(--page-status-error-fg, #c62828)", fontWeight: 700 };
  return { color: "var(--color-text-muted)" };
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
  const s = d.current_liveness_state?.trim();
  return s || "waiting_for_first_payload";
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

const HIDE_STATUS_OPTIONS: { key: string; label: string }[] = [
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
  const { siteId: opsSiteId, refreshToken } = useOpsShell();
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

  /** When true for a bucket key, rows matching that Activation / Connectivity / Status value are hidden (client-side only; search is unchanged). */
  const [hideActivation, setHideActivation] = useState<Record<string, boolean>>({});
  const [hideConnectivity, setHideConnectivity] = useState<Record<string, boolean>>({});
  const [hideStatus, setHideStatus] = useState<Record<string, boolean>>({});

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

  const loadDevices = useCallback(async (q: string) => {
    setTableLoading(true);
    setErr(null);
    try {
      const list = await listDevices({
        q: q.trim() || undefined,
        site_id: opsSiteId?.trim() || undefined,
      });
      setItems(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load devices");
    } finally {
      setTableLoading(false);
      setLoading(false);
    }
  }, [opsSiteId]);

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
  }, [appliedQ, loadDevices]);

  const visibleItems = useMemo(() => {
    return items.filter((d) => {
      if (hideActivation[activationBucket(d)]) return false;
      if (hideConnectivity[connectivityBucket(d)]) return false;
      if (hideStatus[livenessBucket(d)]) return false;
      return true;
    });
  }, [items, hideActivation, hideConnectivity, hideStatus]);

  const hideFilterActive = useMemo(() => {
    return (
      Object.values(hideActivation).some(Boolean) ||
      Object.values(hideConnectivity).some(Boolean) ||
      Object.values(hideStatus).some(Boolean)
    );
  }, [hideActivation, hideConnectivity, hideStatus]);

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

  function openCreateModal() {
    setErr(null);
    setOk(null);
    setEditId(null);
    setName("");
    setDescription("");
    setSiteId(sites[0]?.id ?? "");
    setModalMode("create");
  }

  function openEditModal(d: DeviceRead) {
    setErr(null);
    setOk(null);
    setEditId(d.id);
    setName(d.name);
    setDescription(d.description ?? "");
    setSiteId(d.site_id);
    setModalMode("edit");
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(searchInput);
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
    if (d.last_seen_at) return formatOptionalTs(d.last_seen_at);
    const lp = d.endpoint?.last_payload_at;
    if (lp) return formatOptionalTs(lp);
    return "—";
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

  return (
    <PageShell title="Manage Devices">
      <div style={stack}>
        <div style={leadScrollWrap}>
          <p style={lead}>Search registered devices by name or description.</p>
        </div>

        {err ? <PageStatus variant="error">{err}</PageStatus> : null}
        {ok ? <PageStatus variant="success">{ok}</PageStatus> : null}

        <form onSubmit={onSearch} style={toolbar}>
          <label style={searchLbl}>
            Search
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Name or description"
              style={searchInp}
            />
          </label>
          <button type="submit" style={btnSecondary} disabled={tableLoading}>
            Search
          </button>
          <button type="button" style={btnPrimary} onClick={openCreateModal}>
            Register new device
          </button>
        </form>

        <details style={hideDetails}>
          <summary style={hideDetailsSummary}>Advanced Search</summary>
          <p style={hideHint}>
            Checked options remove matching rows from the list below. Name/description search and API results are unchanged;
            only the displayed rows are filtered.
          </p>
          <div style={hideGrid}>
            <div style={hideGroup}>
              <div style={hideGroupTitle}>Activation</div>
              {HIDE_ACTIVATION_OPTIONS.map(({ key, label }) => (
                <label key={`act-${key}`} style={hideCheckboxLbl}>
                  <input
                    type="checkbox"
                    checked={!!hideActivation[key]}
                    onChange={() =>
                      setHideActivation((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div style={hideGroup}>
              <div style={hideGroupTitle}>Connectivity</div>
              {HIDE_CONNECTIVITY_OPTIONS.map(({ key, label }) => (
                <label key={`conn-${key}`} style={hideCheckboxLbl}>
                  <input
                    type="checkbox"
                    checked={!!hideConnectivity[key]}
                    onChange={() =>
                      setHideConnectivity((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div style={hideGroup}>
              <div style={hideGroupTitle}>Status (liveness)</div>
              {HIDE_STATUS_OPTIONS.map(({ key, label }) => (
                <label key={`st-${key}`} style={hideCheckboxLbl}>
                  <input
                    type="checkbox"
                    checked={!!hideStatus[key]}
                    onChange={() =>
                      setHideStatus((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          {hideFilterActive ? (
            <button
              type="button"
              style={btnSecondary}
              onClick={() => {
                setHideActivation({});
                setHideConnectivity({});
                setHideStatus({});
              }}
            >
              Clear all hide options
            </button>
          ) : null}
        </details>

        {hideFilterActive && items.length > 0 ? (
          <p style={hideSummary}>
            Showing <strong>{visibleItems.length}</strong> of <strong>{items.length}</strong> device
            {items.length === 1 ? "" : "s"} from the current search.
          </p>
        ) : null}

        <div style={tableWrap} id="registered-devices-table">
          <table className="ops-data-table" style={tbl}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Site</th>
                <th style={th}>Description</th>
                <th style={th}>Protocol</th>
                <th style={th}>Activation</th>
                <th style={th}>Connectivity</th>
                <th style={th}>Status</th>
                <th style={th}>Last data</th>
                <th style={th} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={9} style={tdEmpty}>
                    Loading…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} style={tdEmpty}>
                    No devices match{appliedQ ? ` “${appliedQ}”` : ""}.{" "}
                    <button type="button" style={linkBtn} onClick={openCreateModal}>
                      Register one
                    </button>
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={tdEmpty}>
                    All {items.length} device{items.length === 1 ? "" : "s"} from this search are hidden by your hide
                    filters. Clear some options above or use &quot;Clear all hide options&quot;.
                  </td>
                </tr>
              ) : (
                visibleItems.map((d) => (
                    <tr key={d.id}>
                      <td style={td}>{d.name}</td>
                      <td style={td}>
                        <small>{sitesById[d.site_id] ?? d.site_id.slice(0, 8) + "…"}</small>
                      </td>
                      <td style={tdDesc}>
                        <span title={d.description ?? undefined}>{d.description?.trim() ? d.description : "—"}</span>
                      </td>
                      <td style={tdProto}>{protocolLabel(d)}</td>
                      <td style={td}>
                        {d.endpoint?.activation_status ? (
                          <small style={activationStatusStyle(d.endpoint.activation_status)}>
                            {formatActivationLabel(d.endpoint.activation_status)}
                          </small>
                        ) : (
                          <small>—</small>
                        )}
                      </td>
                      <td style={td}>
                        <small style={connectivityStyle(d)} title={connectivityTitle(d)}>
                          {connectivityLabel(d)}
                        </small>
                      </td>
                      <td style={td}>
                        <small style={livenessStyle(d.current_liveness_state)}>{livenessLabel(d.current_liveness_state)}</small>
                      </td>
                      <td style={tdMuted}>{lastDataSummary(d)}</td>
                      <td style={tdAct}>
                        <div style={actRow}>
                          <Link
                            to={`/devices/manage?device=${encodeURIComponent(d.id)}`}
                            style={iconLink}
                            title="Manage device — endpoint and ingest"
                            aria-label={`Manage device ${d.name}`}
                          >
                            <ManageDeviceIcon />
                          </Link>
                          <Link
                            to={`/devices/raw?deviceId=${encodeURIComponent(d.id)}`}
                            style={iconLink}
                            title="View raw sample archives for this device"
                            aria-label={`Raw sample for ${d.name}`}
                          >
                            <RawSampleIcon />
                          </Link>
                          {d.endpoint?.activation_status === "active" ? (
                            <Link
                              to={`/scrubber/create?deviceId=${encodeURIComponent(d.id)}&returnTo=${encodeURIComponent("/devices/register#registered-devices-table")}`}
                              style={iconLink}
                              title="Open Scrubber Studio (uses latest archived raw if no newer sample)"
                              aria-label={`Open scrubber for ${d.name}`}
                            >
                              <BrushCleaning size={16} strokeWidth={2} aria-hidden />
                            </Link>
                          ) : (
                            <button
                              type="button"
                              style={{ ...iconBtn, opacity: 0.45, cursor: "not-allowed" }}
                              disabled
                              title={
                                d.endpoint
                                  ? "Scrubber is available when activation status is Active."
                                  : "Save an endpoint and reach Active activation to open the scrubber from this list."
                              }
                              aria-label={`Scrubber unavailable for ${d.name}`}
                            >
                              <BrushCleaning size={16} strokeWidth={2} aria-hidden />
                            </button>
                          )}
                          <button
                            type="button"
                            style={iconBtn}
                            title="Edit registration"
                            aria-label={`Edit registration for ${d.name}`}
                            onClick={() => openEditModal(d)}
                          >
                            <EditIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p style={connectivityActions}>
          <span
            style={{ display: "inline-block" }}
            title="Re-runs endpoint validation (reachability and payload checks) for each row that has a saved endpoint, then refreshes connectivity status."
          >
            <button
              type="button"
              style={{
                ...linkBtn,
                ...(checkingConnectivity || tableLoading || items.length === 0
                  ? { opacity: 0.55, cursor: "not-allowed" as const }
                  : {}),
              }}
              disabled={checkingConnectivity || tableLoading || items.length === 0}
              onClick={() => void checkConnectivityForListedDevices()}
            >
              {checkingConnectivity ? "Checking connectivity…" : "Check connectivity for listed devices"}
            </button>
          </span>
        </p>
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

function EditIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ManageDeviceIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function RawSampleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M10 12h4M10 16h4M8 8h1" />
    </svg>
  );
}

const stack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  minHeight: 0,
};

const leadScrollWrap: CSSProperties = {
  maxWidth: "100%",
  overflowX: "auto",
  overflowY: "hidden",
  WebkitOverflowScrolling: "touch",
};

const lead: CSSProperties = {
  margin: 0,
  fontSize: "0.72rem",
  lineHeight: 1.35,
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const toolbar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.65rem",
  alignItems: "flex-end",
};

const hideDetails: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: "0.5rem 0.75rem 0.65rem",
  margin: 0,
  background: "var(--color-surface-elevated)",
};

const hideDetailsSummary: CSSProperties = {
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--color-text)",
  cursor: "pointer",
  padding: "0.15rem 0",
};

const hideHint: CSSProperties = {
  margin: "0 0 0.5rem",
  fontSize: "0.72rem",
  lineHeight: 1.4,
  color: "var(--color-text-muted)",
  maxWidth: "56rem",
};

const hideGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "0.75rem 1.25rem",
  marginBottom: "0.5rem",
};

const hideGroup: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  minWidth: 0,
};

const hideGroupTitle: CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.02em",
};

const hideCheckboxLbl: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  fontSize: "0.78rem",
  color: "var(--color-text)",
  cursor: "pointer",
  lineHeight: 1.3,
};

const hideSummary: CSSProperties = {
  margin: 0,
  fontSize: "0.78rem",
  color: "var(--color-text-muted)",
};

const searchLbl: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  flex: "0 1 auto",
  width: "min(220px, 100%)",
  maxWidth: "220px",
};

const searchInp: CSSProperties = {
  padding: "0.3rem 0.4rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  width: "100%",
  maxWidth: "220px",
  boxSizing: "border-box",
};

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

const tableWrap: CSSProperties = {
  overflow: "auto",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  flex: 1,
  minHeight: 0,
};

const connectivityActions: CSSProperties = {
  margin: "0.35rem 0 0",
  fontSize: "0.85rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.45,
  maxWidth: "48rem",
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
  background: "var(--color-surface-elevated)",
  color: "var(--color-text-muted)",
  fontWeight: 600,
};

const td: CSSProperties = {
  padding: "0.45rem 0.65rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};

const tdDesc: CSSProperties = {
  ...td,
  maxWidth: "320px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const tdProto: CSSProperties = {
  ...td,
  fontSize: "0.82rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const tdMuted: CSSProperties = {
  ...td,
  fontSize: "0.82rem",
  color: "var(--color-text-muted)",
  maxWidth: "11rem",
};

const tdAct: CSSProperties = {
  ...td,
  width: "9.25rem",
  textAlign: "right",
};

const actRow: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  gap: "0.35rem",
  alignItems: "center",
  justifyContent: "flex-end",
};

const iconLink: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.35rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-accent)",
  textDecoration: "none",
  cursor: "pointer",
};

const tdEmpty: CSSProperties = {
  ...td,
  color: "var(--color-text-muted)",
  padding: "1.25rem",
};

const iconBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.35rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  cursor: "pointer",
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
