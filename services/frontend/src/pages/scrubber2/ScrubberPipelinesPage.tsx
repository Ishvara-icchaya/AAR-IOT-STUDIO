import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, GitBranch, Pencil, RefreshCw, Search } from "lucide-react";
import { apiFetch } from "@/api/client";
import { listDevices, type DeviceRead } from "@/api/devices";
import { PageStatus } from "@/components/PageStatus";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { OpsListPage } from "@/components/ops/OpsListPage";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsScopeBar } from "@/components/ops/OpsScopeBar";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { OpsStatusPill } from "@/components/ops/OpsStatusPill";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import { normalizeProtocol } from "@/lib/deviceEndpointConfig";
import { lastDataReceivedMs } from "@/lib/deviceLivenessDisplay";

type SiteRow = { id: string; name: string };

type DeviceObjectRead = {
  id: string;
  device_id: string;
  site_id: string;
  mapping: Record<string, unknown>;
  updated_at?: string | null;
};

type PipelineStatus = "active" | "draft" | "disabled" | "error";

type PipelineRow = {
  deviceId: string;
  pipelineName: string;
  deviceName: string;
  siteId: string;
  protocol: string;
  version: string;
  status: PipelineStatus;
  lastPublished: string | null;
  lastData: string | null;
};

const PAGE_SIZE = 25;

function protocolLabel(p: string | null | undefined): string {
  const n = normalizeProtocol(String(p || ""));
  if (n === "http") return "HTTP";
  if (n === "websocket") return "WebSocket";
  if (!n) return "—";
  return n.toUpperCase();
}

function fmtAgo(ms: number | null): string {
  if (ms == null) return "—";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(ms).toLocaleString();
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const x = new Date(iso).getTime();
  return Number.isFinite(x) ? x : null;
}

function toneForStatus(s: PipelineStatus): "online" | "degraded" | "offline" | "error" | "muted" {
  if (s === "active") return "online";
  if (s === "draft") return "muted";
  if (s === "disabled") return "offline";
  return "error";
}

function deriveStatus(mapping: Record<string, unknown>): PipelineStatus {
  const ss = mapping.scrubberStudio as Record<string, unknown> | undefined;
  const published = Boolean(ss?.published);
  const hasDraft = typeof ss?.draft === "object" && ss?.draft !== null;
  if (published) return "active";
  if (hasDraft) return "draft";
  return "disabled";
}

function deriveName(device: DeviceRead, mapping: Record<string, unknown>): string {
  const ss = mapping.scrubberStudio as Record<string, unknown> | undefined;
  const draft = ss?.draft as Record<string, unknown> | undefined;
  const out = draft?.output_data_object as Record<string, unknown> | undefined;
  const n = typeof out?.name === "string" ? out.name.trim() : "";
  if (n) return n;
  return `${device.name} Pipeline`;
}

export function ScrubberPipelinesPage() {
  const navigate = useNavigate();
  const { siteId: opsSiteId, setSiteId: setOpsSiteId, refreshToken } = useOpsShell();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState<"all" | PipelineStatus>("all");
  const [protocol, setProtocol] = useState("all");
  const [page, setPage] = useState(0);
  useShellFeedback(err, null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [siteRows, devices] = await Promise.all([
        apiFetch<SiteRow[]>("/administration/sites"),
        listDevices(opsSiteId ? { site_id: opsSiteId } : undefined),
      ]);
      setSites(siteRows ?? []);
      const siteMap: Record<string, string> = {};
      for (const s of siteRows ?? []) siteMap[s.id] = s.name;
      setSitesById(siteMap);

      const deviceObjectResults = await Promise.all(
        devices.map(async (d) => {
          try {
            return await apiFetch<DeviceObjectRead | null>(`/device-objects?device_id=${encodeURIComponent(d.id)}`);
          } catch {
            return null;
          }
        }),
      );

      const next: PipelineRow[] = [];
      for (let i = 0; i < devices.length; i++) {
        const d = devices[i];
        const obj = deviceObjectResults[i];
        if (!obj?.mapping || typeof obj.mapping !== "object") continue;
        const s = deriveStatus(obj.mapping);
        const ss = obj.mapping.scrubberStudio as Record<string, unknown> | undefined;
        const version = typeof ss?.version === "string" && ss.version.trim() ? ss.version : "—";
        const publishedAt = toMs(obj.updated_at);
        next.push({
          deviceId: d.id,
          pipelineName: deriveName(d, obj.mapping),
          deviceName: d.name,
          siteId: d.site_id,
          protocol: protocolLabel(d.endpoint?.protocol ?? null),
          version: version === "—" ? "—" : `v${version}`,
          status: s,
          lastPublished: fmtAgo(publishedAt),
          lastData: fmtAgo(lastDataReceivedMs(d)),
        });
      }
      setRows(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load pipelines");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [opsSiteId]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const protocols = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.protocol).filter((x) => x && x !== "—"))).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = appliedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (protocol !== "all" && r.protocol !== protocol) return false;
      if (!q) return true;
      const hay = `${r.pipelineName} ${r.deviceName} ${r.protocol}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, appliedSearch, status, protocol]);

  const kpi = useMemo(() => {
    let active = 0;
    let draft = 0;
    let disabled = 0;
    let error = 0;
    for (const r of filtered) {
      if (r.status === "active") active++;
      else if (r.status === "draft") draft++;
      else if (r.status === "disabled") disabled++;
      else error++;
    }
    return { total: filtered.length, active, draft, disabled, error };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => setPage(0), [appliedSearch, status, protocol, opsSiteId]);

  return (
    <OpsListPage
      className="scrubber-pipelines-page device-manage-page"
      header={
        <OpsPageHeader
          title="Scrubber Pipelines"
          subtitle="Manage active data transformation pipelines."
          actions={
            <>
              <button type="button" className="dm-btn dm-btn--outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw size={16} aria-hidden />
                Refresh
              </button>
              <button
                type="button"
                className="dm-btn dm-btn--primary"
                onClick={() => navigate("/scrubber/v2/create")}
                disabled={loading}
              >
                Create Pipeline
              </button>
            </>
          }
        />
      }
      scopeBar={
        <OpsScopeBar>
          <div className="dm-page-scope-strip">
            <OpsScopeControls variant="inline" timeRangeLabel="Range" />
          </div>
        </OpsScopeBar>
      }
      kpiRow={
        <OpsKpiRow ariaLabel="Scrubber pipeline summary" className="dm-kpi-row--equal-5">
          <div className="dm-kpi"><div className="dm-kpi__body"><div className="dm-kpi__label">Total</div><div className="dm-kpi__value">{kpi.total}</div></div></div>
          <div className="dm-kpi"><div className="dm-kpi__body"><div className="dm-kpi__label">Active</div><div className="dm-kpi__value">{kpi.active}</div></div></div>
          <div className="dm-kpi"><div className="dm-kpi__body"><div className="dm-kpi__label">Draft</div><div className="dm-kpi__value">{kpi.draft}</div></div></div>
          <div className="dm-kpi"><div className="dm-kpi__body"><div className="dm-kpi__label">Disabled</div><div className="dm-kpi__value">{kpi.disabled}</div></div></div>
          <div className="dm-kpi"><div className="dm-kpi__body"><div className="dm-kpi__label">Errors</div><div className="dm-kpi__value">{kpi.error}</div></div></div>
        </OpsKpiRow>
      }
      filterPanel={
        <OpsFilterPanel ariaLabel="Pipeline filters">
          <div className="dm-controls-form__row">
            <div className="dm-search-wrap">
              <Search size={16} aria-hidden />
              <input
                className="dm-search-input"
                placeholder="Search pipelines..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setAppliedSearch(search);
                }}
              />
            </div>
            <button type="button" className="dm-btn dm-btn--primary dm-btn--search" onClick={() => setAppliedSearch(search)}>
              Search
            </button>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Site</span>
              <select value={opsSiteId ?? ""} onChange={(e) => setOpsSiteId(e.target.value || null)}>
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as "all" | PipelineStatus)}>
                <option value="all">All</option>
                <option value="active">active</option>
                <option value="draft">draft</option>
                <option value="disabled">disabled</option>
                <option value="error">error</option>
              </select>
            </label>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Protocol</span>
              <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                <option value="all">All</option>
                {protocols.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </OpsFilterPanel>
      }
      content={
        <OpsDataTable>
          {err ? <PageStatus variant="error">{err}</PageStatus> : null}

          <div className="dm-device-table-shell">
            <div className="dm-table-scroll">
              <table className="dm-data-table">
                <thead>
                  <tr>
                    <th className="dm-data-table__th">Pipeline</th>
                    <th className="dm-data-table__th">Device</th>
                    <th className="dm-data-table__th">Site</th>
                    <th className="dm-data-table__th">Protocol</th>
                    <th className="dm-data-table__th dm-data-table__th--center">Version</th>
                    <th className="dm-data-table__th dm-data-table__th--center">Status</th>
                    <th className="dm-data-table__th">Last published</th>
                    <th className="dm-data-table__th">Last data</th>
                    <th className="dm-data-table__th dm-data-table__th--actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="dm-data-table__empty" colSpan={9}>
                        Loading…
                      </td>
                    </tr>
                  ) : pageRows.length === 0 ? (
                    <tr>
                      <td className="dm-data-table__empty" colSpan={9}>
                        No scrubber pipelines match the current filters.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((r) => (
                      <tr key={r.deviceId} className="dm-data-table__row">
                        <td className="dm-data-table__td">{r.pipelineName}</td>
                        <td className="dm-data-table__td">{r.deviceName}</td>
                        <td className="dm-data-table__td">
                          <small>{sitesById[r.siteId] ?? `${r.siteId.slice(0, 8)}…`}</small>
                        </td>
                        <td className="dm-data-table__td">{r.protocol}</td>
                        <td className="dm-data-table__td dm-data-table__td--center">{r.version}</td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <OpsStatusPill status={r.status} variant={toneForStatus(r.status)} />
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--muted">{r.lastPublished}</td>
                        <td className="dm-data-table__td dm-data-table__td--muted">{r.lastData}</td>
                        <td className="dm-data-table__td dm-data-table__td--actions">
                          <div className="dm-act-grid">
                            <Link className="dm-act-grid__btn" to={`/scrubber/v2/create?deviceId=${encodeURIComponent(r.deviceId)}`} title="Edit pipeline">
                              <Pencil size={16} aria-hidden />
                            </Link>
                            <Link className="dm-act-grid__btn dm-act-grid__btn--plain" to={`/devices/manage?device=${encodeURIComponent(r.deviceId)}`} title="View device">
                              <Eye size={16} aria-hidden />
                            </Link>
                            <OpsActionButton tone="plain" title="Versions (coming soon)" disabled>
                              <GitBranch size={16} aria-hidden />
                            </OpsActionButton>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </OpsDataTable>
      }
      pagination={
          <div className="dm-table-pager" role="navigation" aria-label="Pagination">
            <span className="dm-table-pager__meta">
              {filtered.length === 0
                ? "0 pipelines"
                : `Showing ${safePage * PAGE_SIZE + 1}–${Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of ${filtered.length}`}
            </span>
            <div className="dm-table-pager__controls">
              <button type="button" className="dm-act-grid__btn dm-act-grid__btn--text" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={16} aria-hidden />
                Prev
              </button>
              <span className="dm-table-pager__page">
                Page {safePage + 1} / {pageCount}
              </span>
              <button type="button" className="dm-act-grid__btn dm-act-grid__btn--text" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>
                Next
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          </div>
      }
    />
  );
}
