import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Activity, Ban, Copy, Pencil, Rocket, Search, Trash2 } from "lucide-react";
import { AarButton } from "@/components/system/AarButton";
import { OpsActionButton } from "@/components/ops/OpsActionButton";
import { OpsDataTable } from "@/components/ops/OpsDataTable";
import { OpsFilterPanel } from "@/components/ops/OpsFilterPanel";
import { OpsKpiRow } from "@/components/ops/OpsKpiRow";
import { OpsListPage } from "@/components/ops/OpsListPage";
import { OpsPageHeader } from "@/components/ops/OpsPageHeader";
import { OpsScopeControls } from "@/components/ops/OpsScopeControls";
import { OpsStatusPill } from "@/components/ops/OpsStatusPill";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { PageStatus } from "@/components/PageStatus";
import { apiFetch } from "@/api/client";
import type { WorkflowListItemDTO } from "@/types/workflow";
import "../device-register-page.css";

type SiteOpt = { id: string; name: string };

const PAGE_SIZE = 25;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function workflowLifecycleTone(status: string): "online" | "degraded" | "offline" | "error" | "muted" {
  const s = (status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "error";
  if (s.includes("publish") || s.includes("live") || s.includes("active")) return "online";
  if (s.includes("draft") || s.includes("idle")) return "muted";
  return "degraded";
}

export function WorkflowListPage() {
  const navigate = useNavigate();
  const confirm = useConfirmAction();
  const { siteId: opsSiteId, refreshToken } = useOpsShell();
  const [sites, setSites] = useState<SiteOpt[]>([]);

  const [items, setItems] = useState<WorkflowListItemDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [lifecycleContains, setLifecycleContains] = useState("");
  const [publishedFilter, setPublishedFilter] = useState<"all" | "published" | "draft">("all");
  const [page, setPage] = useState(0);

  const sitesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sites) m.set(s.id, s.name);
    return m;
  }, [sites]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<SiteOpt[]>("/administration/sites");
        setSites(data ?? []);
      } catch {
        setSites([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (opsSiteId) params.set("site_id", opsSiteId);
      if (appliedQ.trim()) params.set("q", appliedQ.trim());
      const qs = params.toString();
      const path = qs ? `/workflows?${qs}` : "/workflows";
      const data = await apiFetch<{ items: WorkflowListItemDTO[] }>(path);
      const rows = data?.items;
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workflows");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [opsSiteId, appliedQ]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const filtered = useMemo(() => {
    const lc = lifecycleContains.trim().toLowerCase();
    return items.filter((w) => {
      if (publishedFilter === "published" && !w.is_published) return false;
      if (publishedFilter === "draft" && w.is_published) return false;
      if (lc) {
        const hay = `${w.lifecycle_status || ""} ${w.name || ""}`.toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });
  }, [items, lifecycleContains, publishedFilter]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    const published = filtered.filter((w) => w.is_published).length;
    const draft = total - published;
    const sitesSet = new Set(filtered.map((w) => w.site_id).filter(Boolean) as string[]);
    const lastUpdated = filtered.reduce<string | null>((acc, w) => {
      if (!w.updated_at) return acc;
      if (!acc || w.updated_at > acc) return w.updated_at;
      return acc;
    }, null);
    return { total, published, draft, siteCount: sitesSet.size, lastUpdated };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [appliedQ, opsSiteId, lifecycleContains, publishedFilter, items.length]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  async function handlePublish(wf: WorkflowListItemDTO) {
    const ok = await confirm({
      title: "Publish workflow?",
      message: `Publish "${wf.name}" and make it live for executions.`,
      confirmLabel: "Publish workflow",
      variant: "success",
    });
    if (!ok) return;
    try {
      await apiFetch(`/workflows/${wf.id}/publish`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    }
  }

  async function handleStop(wf: WorkflowListItemDTO) {
    const ok = await confirm({
      title: "Stop published workflow?",
      message: `This stops "${wf.name}". New executions will not run until it is published again.`,
      confirmLabel: "Stop workflow",
      variant: "warning",
    });
    if (!ok) return;
    try {
      await apiFetch(`/workflows/${wf.id}/stop-publish`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stop failed");
    }
  }

  async function handleDuplicate(wf: WorkflowListItemDTO) {
    const name = `${wf.name} (copy)`;
    const ok = await confirm({
      title: "Duplicate workflow?",
      message: `Create a duplicate named "${name}".`,
      confirmLabel: "Duplicate workflow",
      variant: "default",
    });
    if (!ok) return;
    try {
      const created = await apiFetch<{ id: string }>(`/workflows/${wf.id}/duplicate`, {
        method: "POST",
        json: { name },
      });
      await load();
      if (created?.id) navigate(`/workflow/${created.id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Duplicate failed");
    }
  }

  async function handleDelete(wf: WorkflowListItemDTO) {
    const ok = await confirm({
      title: "Delete workflow?",
      message: `Delete "${wf.name}"? This cannot be undone.`,
      confirmLabel: "Delete workflow",
      variant: "danger",
      requireText: "DELETE",
    });
    if (!ok) return;
    try {
      await apiFetch(`/workflows/${wf.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <OpsListPage
      className="workflow-list-page device-manage-page"
      header={
        <OpsPageHeader
          title="Workflows"
          subtitle="View and manage automation workflows across your sites."
          actions={
            <AarButton type="button" variant="primary" onClick={() => navigate("/workflow/create")}>
              + Create workflow
            </AarButton>
          }
        />
      }
      kpiRow={
        <OpsKpiRow ariaLabel="Workflow summary" className="dm-kpi-row--equal-5">
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Matching</div>
              <div className="dm-kpi__value">{kpis.total}</div>
              <div className="dm-kpi__sub">After filters on this page</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Published</div>
              <div className="dm-kpi__value">{kpis.published}</div>
              <div className="dm-kpi__sub">Live pointer set</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Draft / not live</div>
              <div className="dm-kpi__value">{kpis.draft}</div>
              <div className="dm-kpi__sub">Unpublished or superseded</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Sites in view</div>
              <div className="dm-kpi__value">{kpis.siteCount}</div>
              <div className="dm-kpi__sub">Distinct site_id in list</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Newest update</div>
              <div className="dm-kpi__value" style={{ fontSize: "0.95rem" }}>
                {formatDateTime(kpis.lastUpdated)}
              </div>
              <div className="dm-kpi__sub">Max updated_at in list</div>
            </div>
          </div>
        </OpsKpiRow>
      }
      filterPanel={
        <OpsFilterPanel ariaLabel="Filters">
          <div className="dm-controls-form__row">
            <OpsScopeControls variant="filters" timeRangeLabel="Range" />
            <div className="dm-search-wrap">
              <Search size={16} aria-hidden />
              <input
                className="dm-search-input"
                placeholder="Search name (server)…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setAppliedQ(searchInput);
                  }
                }}
              />
            </div>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Published</span>
              <select
                value={publishedFilter}
                onChange={(e) => setPublishedFilter(e.target.value as typeof publishedFilter)}
              >
                <option value="all">All</option>
                <option value="published">Published only</option>
                <option value="draft">Not published</option>
              </select>
            </label>
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">Name or status contains</span>
              <input
                type="text"
                value={lifecycleContains}
                onChange={(e) => setLifecycleContains(e.target.value)}
                placeholder="Client filter on name + lifecycle…"
              />
            </label>
            <AarButton type="button" variant="primary" className="aar-btn--search dm-btn--search" onClick={() => setAppliedQ(searchInput)}>
              Search
            </AarButton>
          </div>
        </OpsFilterPanel>
      }
      content={
        <OpsDataTable>
          {error ? <PageStatus variant="error">{error}</PageStatus> : null}
          {loading && items.length === 0 ? (
            <p className="dm-empty">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="dm-empty">
              {loading && items.length > 0 ? "Updating list…" : "No workflows match the current filters."}
            </p>
          ) : (
            <div className="dm-device-table-shell" aria-busy={loading}>
              {loading && items.length > 0 ? <p className="dm-table-loading">Updating list…</p> : null}
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
                      Published
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      Version
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      Inputs
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      Terminates
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
                  {pageItems.map((wf) => {
                    const siteLabel = wf.site_id ? sitesById.get(wf.site_id) || wf.site_id : "—";
                    return (
                      <tr key={wf.id} className="dm-data-table__row">
                        <td className="dm-data-table__td">
                          <Link className="dm-name-link" to={`/workflow/${wf.id}/edit`}>
                            {wf.name}
                          </Link>
                        </td>
                        <td className="dm-data-table__td">
                          <small>{siteLabel}</small>
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <OpsStatusPill status={wf.lifecycle_status} variant={workflowLifecycleTone(wf.lifecycle_status)} />
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">{wf.is_published ? "Yes" : "No"}</td>
                        <td className="dm-data-table__td dm-data-table__td--center">{wf.version}</td>
                        <td className="dm-data-table__td dm-data-table__td--center">{wf.input_count}</td>
                        <td className="dm-data-table__td dm-data-table__td--center">{wf.terminate_count}</td>
                        <td className="dm-data-table__td dm-data-table__td--muted">{formatDateTime(wf.updated_at)}</td>
                        <td className="dm-data-table__td dm-data-table__td--actions">
                          <div className="dm-act-grid">
                            <Link
                              className="dm-act-grid__btn"
                              to={`/workflow/${wf.id}/edit`}
                              title="Open editor"
                              aria-label={`Open editor for ${wf.name}`}
                            >
                              <Pencil size={16} strokeWidth={2} aria-hidden />
                            </Link>
                            <Link
                              className="dm-act-grid__btn"
                              to={`/workflow/${wf.id}/live`}
                              title="Live runs and results"
                              aria-label={`Live view for ${wf.name}`}
                            >
                              <Activity size={16} strokeWidth={2} aria-hidden />
                            </Link>
                            {!wf.is_published ? (
                              <OpsActionButton title="Publish workflow" aria-label={`Publish ${wf.name}`} onClick={() => void handlePublish(wf)}>
                                <Rocket size={16} strokeWidth={2} aria-hidden />
                              </OpsActionButton>
                            ) : (
                              <OpsActionButton title="Stop published workflow" aria-label={`Stop published ${wf.name}`} onClick={() => void handleStop(wf)}>
                                <Ban size={16} strokeWidth={2} aria-hidden />
                              </OpsActionButton>
                            )}
                            <OpsActionButton title="Duplicate workflow" aria-label={`Duplicate ${wf.name}`} onClick={() => void handleDuplicate(wf)}>
                              <Copy size={16} strokeWidth={2} aria-hidden />
                            </OpsActionButton>
                            <OpsActionButton tone="danger" title="Delete workflow" aria-label={`Delete ${wf.name}`} onClick={() => void handleDelete(wf)}>
                              <Trash2 size={16} strokeWidth={2} aria-hidden />
                            </OpsActionButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </OpsDataTable>
      }
      pagination={
          <div className="dm-table-pager" role="navigation" aria-label="Pagination">
            <span className="dm-table-pager__meta">
              {filtered.length === 0
                ? "0 workflows"
                : `Showing ${safePage * PAGE_SIZE + 1}–${Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of ${filtered.length}`}
            </span>
            <div className="dm-table-pager__controls">
              <button
                type="button"
                className="dm-act-grid__btn dm-act-grid__btn--text"
                disabled={safePage <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={16} aria-hidden />
                Prev
              </button>
              <span className="dm-table-pager__page">
                Page {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="dm-act-grid__btn dm-act-grid__btn--text"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          </div>
      }
    />
  );
}
