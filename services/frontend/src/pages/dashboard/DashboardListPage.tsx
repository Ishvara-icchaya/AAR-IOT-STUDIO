import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Copy,
  Lock,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/api/client";
import * as dashApi from "@/api/dashboard";
import type { DashboardListItemDTO } from "@/types/dashboard";
import { useResourceInUse } from "@/contexts/ResourceInUseContext";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { OpsListPage } from "@/components/ops/OpsListPage";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsStatusPill } from "@/components/ops/OpsStatusPill";
import { PageStatus } from "@/components/PageStatus";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import { AppIcon, ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

import "../device-register-page.css";

type SiteRow = { id: string; name: string };

const DASH_TABLE_PAGE_SIZE = 25;

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

function dashboardStatusTone(status: string): "online" | "degraded" | "offline" | "error" | "muted" {
  const s = status.toLowerCase();
  if (s === "frozen") return "online";
  if (s === "draft") return "degraded";
  return "muted";
}

export function DashboardListPage() {
  const { tryHandleResourceInUseError } = useResourceInUse();
  const confirm = useConfirmAction();
  const { pushMessage } = useShellMessage();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [statusContains, setStatusContains] = useState("");
  const [items, setItems] = useState<DashboardListItemDTO[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [tablePage, setTablePage] = useState(1);

  useShellFeedback(err, null);

  const sitesById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sites) m[s.id] = s.name;
    return m;
  }, [sites]);

  const load = useCallback(async () => {
    setTableLoading(true);
    setErr(null);
    try {
      const data = await dashApi.listDashboards({
        site_id: siteId || undefined,
        q: appliedQ.trim() || undefined,
      });
      setItems(data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "List failed");
    } finally {
      setTableLoading(false);
      setLoading(false);
    }
  }, [siteId, appliedQ]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<SiteRow[]>("/administration/sites");
        setSites(data ?? []);
      } catch {
        setSites([]);
      }
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = statusContains.trim().toLowerCase();
    return items.filter((d) => {
      if (statusFilter !== "all" && (d.status || "").toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (q && !(d.status || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, statusFilter, statusContains]);

  const kpiStats = useMemo(() => {
    const rows = filtered;
    const total = rows.length;
    let draft = 0;
    let frozen = 0;
    let inactive = 0;
    let archived = 0;
    let primary = 0;
    const siteIds = new Set<string>();
    for (const d of rows) {
      const s = (d.status || "").toLowerCase();
      if (s === "draft") draft += 1;
      else if (s === "frozen") frozen += 1;
      else if (s === "inactive") inactive += 1;
      else if (s === "archived") archived += 1;
      if (d.is_primary) primary += 1;
      if (d.site_id) siteIds.add(d.site_id);
    }
    let latest: { iso: string; name: string } | null = null;
    let bestMs = -1;
    for (const d of rows) {
      const t = new Date(d.updated_at).getTime();
      if (!Number.isNaN(t) && t > bestMs) {
        bestMs = t;
        latest = { iso: d.updated_at, name: d.name };
      }
    }
    const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");
    return {
      total,
      draft,
      frozen,
      inactive,
      archived,
      primary,
      siteCount: siteIds.size,
      pctDraft: pct(draft),
      pctFrozen: pct(frozen),
      lastRelative: latest ? formatRelativeShort(latest.iso) : "—",
      lastName: latest?.name ?? "",
    };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / DASH_TABLE_PAGE_SIZE));

  useEffect(() => {
    setTablePage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setTablePage(1);
  }, [appliedQ, siteId, statusFilter, statusContains, items.length]);

  const pageRows = useMemo(() => {
    const start = (tablePage - 1) * DASH_TABLE_PAGE_SIZE;
    return filtered.slice(start, start + DASH_TABLE_PAGE_SIZE);
  }, [filtered, tablePage]);

  const onDel = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Delete this dashboard?",
        message: "This action cannot be undone.",
        confirmLabel: "Delete dashboard",
        variant: "danger",
        requireText: "DELETE",
      });
      if (!ok) return;
      setErr(null);
      try {
        await dashApi.deleteDashboard(id);
        pushMessage("success", "Dashboard deleted.");
        await load();
      } catch (e) {
        if (tryHandleResourceInUseError(e)) return;
        setErr(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [confirm, load, pushMessage, tryHandleResourceInUseError],
  );

  const onDup = useCallback(
    async (id: string) => {
      setErr(null);
      try {
        const d = await dashApi.duplicateDashboard(id);
        if (d?.id) {
          pushMessage("success", "Dashboard duplicated.");
          await load();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Duplicate failed");
      }
    },
    [load, pushMessage],
  );

  const onPrimary = useCallback(
    async (id: string) => {
      setErr(null);
      try {
        await dashApi.setPrimaryDashboard(id);
        pushMessage("success", "Primary dashboard updated.");
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Set primary failed");
      }
    },
    [load, pushMessage],
  );

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setAppliedQ(searchInput);
  }

  const filterActive =
    statusFilter !== "all" ||
    !!statusContains.trim() ||
    !!searchInput.trim() ||
    !!appliedQ.trim() ||
    !!siteId.trim();

  function clearFilters() {
    setSearchInput("");
    setAppliedQ("");
    setStatusFilter("all");
    setStatusContains("");
    setSiteId("");
  }

  const tdDesc: CSSProperties = {
    display: "block",
    maxWidth: "14rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <OpsListPage
      className="dashboard-list-page device-manage-page"
      header={
        <OpsPageHeader
          title={
            <Link to="/dashboard/list" className="dm-page-hero__title-link">
              Dashboard List
            </Link>
          }
          subtitle=" / Create dashboard — build or edit Dashboard; return to the list anytime."
          actions={
            <Link to="/dashboard/create" className="dm-btn dm-btn--primary">
              <Plus size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
              Create dashboard
            </Link>
          }
        />
      }
      kpiRow={
        <OpsKpiRow ariaLabel="Dashboard aggregation">
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="dashboard" size="card" className="dm-kpi__label-icon" aria-hidden />
                Total dashboards
              </div>
              <div className="dm-kpi__value">{kpiStats.total}</div>
              <div className="dm-kpi__sub">In current list (after search & filters)</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
              <AppIcon name="dashboard" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <span className="dm-kpi-dot dm-kpi-dot--warn" aria-hidden />
                Draft
              </div>
              <div className="dm-kpi__value">{kpiStats.draft}</div>
              <div className="dm-kpi__sub">{kpiStats.pctDraft}%</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--warn" aria-hidden>
              <AppIcon name="chart" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="settings" size="card" aria-hidden />
                Frozen
              </div>
              <div className="dm-kpi__value">{kpiStats.frozen}</div>
              <div className="dm-kpi__sub">{kpiStats.pctFrozen}%</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--online" aria-hidden>
              <Lock size={ICON_SIZES.card} strokeWidth={ICON_STROKE_WIDTH} />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <Star size={ICON_SIZES.card} strokeWidth={ICON_STROKE_WIDTH} className="dm-kpi__label-icon" aria-hidden />
                Primary
              </div>
              <div className="dm-kpi__value">{kpiStats.primary}</div>
              <div className="dm-kpi__sub">Marked primary in list</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
              <Star size={34} strokeWidth={1.25} />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="device" size="card" className="dm-kpi__label-icon" aria-hidden />
                Sites
              </div>
              <div className="dm-kpi__value">{kpiStats.siteCount}</div>
              <div className="dm-kpi__sub">Distinct site ids</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
              <AppIcon name="device" size="card" aria-hidden />
            </div>
          </div>
          <div className="dm-kpi dm-kpi--with-deco">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <AppIcon name="refresh" size="card" className="dm-kpi__label-icon" aria-hidden />
                Last saved
              </div>
              <div className="dm-kpi__value">{kpiStats.lastRelative}</div>
              <div className="dm-kpi__sub">{kpiStats.lastName ? `Latest: ${kpiStats.lastName}` : "No rows"}</div>
            </div>
            <div className="dm-kpi__deco dm-kpi__deco--muted" aria-hidden>
              <AppIcon name="refresh" size="card" aria-hidden />
            </div>
          </div>
        </OpsKpiRow>
      }
      filterPanel={
        <OpsFilterPanel ariaLabel="Search and filters">
          <form className="dm-controls-form" onSubmit={onSearch}>
            <div className="dm-controls-form__row">
              <div className="dm-search-wrap">
                <Search size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                <input
                  className="dm-search-input"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by dashboard name…"
                  aria-label="Search dashboards by name"
                />
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dash-f-status-text">Status contains</label>
                <input
                  id="dash-f-status-text"
                  type="text"
                  value={statusContains}
                  onChange={(e) => setStatusContains(e.target.value)}
                  placeholder="e.g. draft, frozen…"
                  aria-label="Filter rows where status contains text"
                />
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dash-f-status">Status</label>
                <select id="dash-f-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="draft">draft</option>
                  <option value="frozen">frozen</option>
                  <option value="inactive">inactive</option>
                  <option value="archived">archived</option>
                </select>
              </div>
              <div className="dm-filter-field">
                <label htmlFor="dash-f-site">Site</label>
                <select id="dash-f-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">All permitted</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="dm-clear-filters"
                disabled={!filterActive}
                onClick={clearFilters}
              >
                Clear filters
              </button>
              <button type="submit" className="dm-btn dm-btn--primary dm-btn--search" disabled={tableLoading}>
                Search
              </button>
            </div>
          </form>
        </OpsFilterPanel>
      }
      content={
        <OpsDataTable className="dashboard-list-table-wrap" id="dashboard-list-table">
          {err ? <PageStatus variant="error">{err}</PageStatus> : null}

        {(kpiStats.inactive > 0 || kpiStats.archived > 0) && (
          <p className="dm-inline-summary" style={{ marginTop: 0 }}>
            Also in list: <strong>{kpiStats.inactive}</strong> inactive, <strong>{kpiStats.archived}</strong> archived.
          </p>
        )}

        {filterActive && filtered.length > 0 && items.length > 0 ? (
          <p className="dm-inline-summary">
            Showing <strong>{filtered.length}</strong> of <strong>{items.length}</strong> dashboard
            {items.length === 1 ? "" : "s"} from the server list.
          </p>
        ) : null}

          {loading && items.length === 0 ? (
            <p className="dm-empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="dm-empty">
              No dashboards match{appliedQ ? ` “${appliedQ}”` : ""}.{" "}
              <Link className="dm-name-link" to="/dashboard/create">
                Create one
              </Link>
            </p>
          ) : filtered.length === 0 ? (
            <p className="dm-empty">No dashboards match the status filters. Adjust the text fields or clear filters.</p>
          ) : (
            <div className="dm-device-table-shell" aria-busy={tableLoading}>
              {tableLoading ? <p className="dm-table-loading">Updating list…</p> : null}
              <table className="dm-data-table">
                <thead>
                  <tr>
                    <th className="dm-data-table__th" scope="col">
                      Name
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Site
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      Status
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      Primary
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Updated
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--actions" scope="col">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const sid = row.site_id;
                    const siteLabel = sid ? sitesById[sid] ?? `${sid.slice(0, 8)}…` : "—";
                    return (
                      <tr key={row.id} className="dm-data-table__row">
                        <td className="dm-data-table__td">
                          <span title={row.name} style={tdDesc}>
                            <Link className="dm-name-link" to={`/dashboard/${row.id}/live`}>
                              {row.name}
                            </Link>
                          </span>
                        </td>
                        <td className="dm-data-table__td">
                          <small>{siteLabel}</small>
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <OpsStatusPill status={row.status} variant={dashboardStatusTone(row.status)} />
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          {row.is_primary ? <OpsStatusPill status="Yes" variant="online" /> : "—"}
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--muted">
                          {new Date(row.updated_at).toLocaleString()}
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--actions">
                          <div className="dm-act-grid">
                            <Link
                              className="dm-act-grid__btn"
                              to={`/dashboard/${row.id}/edit`}
                              title="Open builder"
                              aria-label={`Edit dashboard ${row.name}`}
                            >
                              <Pencil size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                            </Link>
                            <Link
                              className="dm-act-grid__btn"
                              to={`/dashboard/${row.id}/live`}
                              title="Live view"
                              aria-label={`Live view: ${row.name}`}
                            >
                              <Activity size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                            </Link>
                            <OpsActionButton tone="plain" title="Duplicate dashboard" aria-label={`Duplicate ${row.name}`} onClick={() => void onDup(row.id)}>
                              <Copy size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                            </OpsActionButton>
                            <OpsActionButton tone="plain" title="Set as primary" aria-label={`Set primary: ${row.name}`} onClick={() => void onPrimary(row.id)}>
                              <Star size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                            </OpsActionButton>
                            <OpsActionButton tone="danger" title="Delete dashboard" aria-label={`Delete ${row.name}`} onClick={() => void onDel(row.id)}>
                              <Trash2 size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                            </OpsActionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {totalPages > 1 ? (
                <div className="dm-table-pager" role="navigation" aria-label="Dashboard table pages">
                  <span className="dm-table-pager__meta">
                    {(tablePage - 1) * DASH_TABLE_PAGE_SIZE + 1}–
                    {Math.min(filtered.length, tablePage * DASH_TABLE_PAGE_SIZE)} of {filtered.length}
                  </span>
                  <div className="dm-table-pager__controls">
                    <button
                      type="button"
                      className="dm-act-grid__btn dm-act-grid__btn--text"
                      disabled={tablePage <= 1}
                      onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft size={16} aria-hidden />
                      Prev
                    </button>
                    <span className="dm-table-pager__page">
                      Page {tablePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="dm-act-grid__btn dm-act-grid__btn--text"
                      disabled={tablePage >= totalPages}
                      onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
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
      }
    />
  );
}
