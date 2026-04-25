import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FlaskConical,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import {
  deletePublishedService,
  listPublishedServices,
  restartPublishedService,
  startPublishedService,
  stopPublishedService,
  type PublishedServiceRow,
} from "@/api/publishedServices";
import { apiFetch } from "@/api/client";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { useResourceInUse } from "@/contexts/ResourceInUseContext";
import { PageShell } from "@/layouts/PageShell";
import { PageStatus } from "@/components/PageStatus";
import { DmTableStatusMetric, type DmTableStatusTone } from "@/components/app";
import { useShellMessage } from "@/layouts/shell/ShellMessageContext";
import { useShellFeedback } from "@/layouts/shell/useShellFeedback";
import "../device-register-page.css";

type SiteOpt = { id: string; name: string };

const PAGE_SIZE = 25;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function publishedServiceStatusTone(status: string): DmTableStatusTone {
  const s = (status || "").toLowerCase();
  if (s === "active") return "online";
  if (s === "failed") return "error";
  if (s === "stopped" || s === "inactive") return "muted";
  if (s === "draft") return "degraded";
  return "muted";
}

export function PublishedServicesListPage() {
  const { tryHandleResourceInUseError } = useResourceInUse();
  const confirm = useConfirmAction();
  const { pushMessage } = useShellMessage();
  const [items, setItems] = useState<PublishedServiceRow[]>([]);
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState("");
  const [protocol, setProtocol] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [objectContains, setObjectContains] = useState("");
  const [errorContains, setErrorContains] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  useShellFeedback(err, null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [data, siteList] = await Promise.all([
        listPublishedServices({
          site_id: siteId || undefined,
          status: status || undefined,
          publish_protocol: protocol || undefined,
          search: appliedSearch.trim() || undefined,
        }),
        apiFetch<SiteOpt[]>("/administration/sites"),
      ]);
      setItems(data?.items ?? []);
      setSites(siteList ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [siteId, status, protocol, appliedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const sitesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sites) m.set(s.id, s.name);
    return m;
  }, [sites]);

  const filtered = useMemo(() => {
    const oc = objectContains.trim().toLowerCase();
    const ec = errorContains.trim().toLowerCase();
    return items.filter((s) => {
      if (oc) {
        const hay = `${s.source_object_name || ""} ${s.name || ""}`.toLowerCase();
        if (!hay.includes(oc)) return false;
      }
      if (ec) {
        const msg = (s.last_error_message || "").toLowerCase();
        if (!msg.includes(ec)) return false;
      }
      return true;
    });
  }, [items, objectContains, errorContains]);

  const kpis = useMemo(() => {
    const total = filtered.length;
    let active = 0;
    let stopped = 0;
    let failed = 0;
    let draft = 0;
    let mqtt = 0;
    let rest = 0;
    for (const s of filtered) {
      const st = (s.status || "").toLowerCase();
      if (st === "active") active += 1;
      else if (st === "stopped" || st === "inactive") stopped += 1;
      else if (st === "failed") failed += 1;
      else if (st === "draft") draft += 1;
      const p = (s.publish_protocol || "").toLowerCase();
      if (p === "mqtt") mqtt += 1;
      if (p === "rest") rest += 1;
    }
    return { total, active, stopped, failed, draft, mqtt, rest };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [siteId, status, protocol, appliedSearch, objectContains, errorContains, items.length]);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const onStartStop = useCallback(
    async (id: string, action: "start" | "stop" | "restart") => {
      try {
        if (action === "start") await startPublishedService(id);
        else if (action === "stop") await stopPublishedService(id);
        else await restartPublishedService(id);
        pushMessage(
          "success",
          `Service ${action === "start" ? "started" : action === "stop" ? "stopped" : "restarted"}.`,
        );
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Action failed");
      }
    },
    [load, pushMessage],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Delete this published service?",
        message: "This action cannot be undone.",
        confirmLabel: "Delete service",
        variant: "danger",
        requireText: "DELETE",
      });
      if (!ok) return;
      try {
        await deletePublishedService(id);
        pushMessage("success", "Published service deleted.");
        await load();
      } catch (e) {
        if (tryHandleResourceInUseError(e)) return;
        setErr(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [confirm, load, pushMessage, tryHandleResourceInUseError],
  );

  return (
    <PageShell
      variant="list"
      className="published-services-list-page published-services-page--full device-manage-page"
    >
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-page-hero__title">Published services</h1>
              <p className="dm-page-hero__subtitle">
                Start, stop, and inspect outbound publishing; KPIs reflect the filters below.
              </p>
            </div>
            <div className="dm-page-hero__actions">
              <Link to="/published-services/create" className="dm-btn dm-btn--primary">
                <Plus size={16} strokeWidth={2} aria-hidden />
                Create
              </Link>
            </div>
          </div>
        </header>

        {err ? <PageStatus variant="error">{err}</PageStatus> : null}

        <section className="dm-kpi-row dm-kpi-row--equal-6" aria-label="Published services summary">
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Matching</div>
              <div className="dm-kpi__value">{kpis.total}</div>
              <div className="dm-kpi__sub">After client filters</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <span className="dm-kpi-dot dm-kpi-dot--online" aria-hidden />
                Active
              </div>
              <div className="dm-kpi__value">{kpis.active}</div>
              <div className="dm-kpi__sub">status = active</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <span className="dm-kpi-dot dm-kpi-dot--offline" aria-hidden />
                Stopped / inactive
              </div>
              <div className="dm-kpi__value">{kpis.stopped}</div>
              <div className="dm-kpi__sub">Not delivering</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">
                <span className="dm-kpi-dot dm-kpi-dot--error" aria-hidden />
                Failed
              </div>
              <div className="dm-kpi__value">{kpis.failed}</div>
              <div className="dm-kpi__sub">Needs attention</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">MQTT / REST</div>
              <div className="dm-kpi__value">
                {kpis.mqtt} / {kpis.rest}
              </div>
              <div className="dm-kpi__sub">Protocols in list</div>
            </div>
          </div>
          <div className="dm-kpi">
            <div className="dm-kpi__body">
              <div className="dm-kpi__label">Draft</div>
              <div className="dm-kpi__value">{kpis.draft}</div>
              <div className="dm-kpi__sub">Not yet running</div>
            </div>
          </div>
        </section>

        <section className="dm-filter-panel" aria-label="Filters">
          <div className="dm-controls-form__row">
            <div className="dm-search-wrap">
              <Search size={16} aria-hidden />
              <input
                className="dm-search-input"
                placeholder="Search service or object (server)…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setAppliedSearch(searchInput);
                }}
              />
            </div>
            <button
              type="button"
              className="dm-btn dm-btn--primary dm-btn--search"
              onClick={() => setAppliedSearch(searchInput)}
            >
              Search
            </button>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Site</span>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">All</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="stopped">stopped</option>
                <option value="failed">failed</option>
                <option value="inactive">inactive</option>
              </select>
            </label>
            <label className="dm-filter-field">
              <span className="dm-filter-field__label">Protocol</span>
              <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                <option value="">All</option>
                <option value="mqtt">mqtt</option>
                <option value="rest">rest</option>
              </select>
            </label>
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">Object or name contains</span>
              <input
                type="text"
                value={objectContains}
                onChange={(e) => setObjectContains(e.target.value)}
                placeholder="Client filter on loaded rows…"
              />
            </label>
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">Last error contains</span>
              <input
                type="text"
                value={errorContains}
                onChange={(e) => setErrorContains(e.target.value)}
                placeholder="Substring in last_error_message…"
              />
            </label>
          </div>
        </section>

        <div className="dm-table-wrap published-services-list__table">
          <div className="dm-device-table-shell">
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
                    <th className="dm-data-table__th" scope="col">
                      Source
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Object
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Protocol
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      Status
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Last published
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Last error
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--actions" scope="col">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="dm-data-table__empty">
                        Loading…
                      </td>
                    </tr>
                  ) : pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="dm-data-table__empty">
                        No services match the current filters.
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((s) => {
                      const siteLabel = s.site_id
                        ? sitesById.get(s.site_id) || `${s.site_id.slice(0, 8)}…`
                        : "—";
                      return (
                        <tr key={s.id} className="dm-data-table__row">
                          <td className="dm-data-table__td">
                            <Link className="dm-name-link" to={`/published-services/${s.id}`}>
                              {s.name}
                            </Link>
                          </td>
                          <td className="dm-data-table__td">
                            <small>{siteLabel}</small>
                          </td>
                          <td className="dm-data-table__td">{s.source_type}</td>
                          <td className="dm-data-table__td">{s.source_object_name}</td>
                          <td className="dm-data-table__td">{s.publish_protocol}</td>
                          <td className="dm-data-table__td dm-data-table__td--center">
                            <DmTableStatusMetric label={s.status} tone={publishedServiceStatusTone(s.status)} />
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--muted">{formatDateTime(s.last_published_at)}</td>
                          <td className="dm-data-table__td dm-data-table__td--desc">
                            {s.last_error_message ? (
                              <span className="dm-inline-summary dm-inline-summary--error" style={{ fontSize: "0.75rem" }}>
                                {s.last_error_message.length > 120
                                  ? `${s.last_error_message.slice(0, 120)}…`
                                  : s.last_error_message}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="dm-data-table__td dm-data-table__td--actions">
                            <div className="dm-act-grid">
                              <Link
                                className="dm-act-grid__btn"
                                to={`/published-services/${s.id}`}
                                title="View service"
                                aria-label={`View ${s.name}`}
                              >
                                <Eye size={16} strokeWidth={2} aria-hidden />
                              </Link>
                              <button
                                type="button"
                                className="dm-act-grid__btn"
                                title="Start service"
                                aria-label={`Start ${s.name}`}
                                onClick={() => void onStartStop(s.id, "start")}
                              >
                                <Play size={16} strokeWidth={2} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="dm-act-grid__btn"
                                title="Stop service"
                                aria-label={`Stop ${s.name}`}
                                onClick={() => void onStartStop(s.id, "stop")}
                              >
                                <Square size={16} strokeWidth={2} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="dm-act-grid__btn dm-act-grid__btn--plain"
                                title="Restart service"
                                aria-label={`Restart ${s.name}`}
                                onClick={() => void onStartStop(s.id, "restart")}
                              >
                                <RotateCw size={16} strokeWidth={2} aria-hidden />
                              </button>
                              <Link
                                className="dm-act-grid__btn dm-act-grid__btn--plain"
                                to={`/published-services/${s.id}/edit`}
                                title="Edit service"
                                aria-label={`Edit ${s.name}`}
                              >
                                <Pencil size={16} strokeWidth={2} aria-hidden />
                              </Link>
                              <Link
                                className="dm-act-grid__btn dm-act-grid__btn--plain"
                                to={`/published-services/${s.id}/test`}
                                title="Test service"
                                aria-label={`Test ${s.name}`}
                              >
                                <FlaskConical size={16} strokeWidth={2} aria-hidden />
                              </Link>
                              <button
                                type="button"
                                className="dm-act-grid__btn dm-act-grid__btn--danger"
                                title="Delete service"
                                aria-label={`Delete ${s.name}`}
                                onClick={() => void onDelete(s.id)}
                              >
                                <Trash2 size={16} strokeWidth={2} aria-hidden />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="dm-table-pager" role="navigation" aria-label="Pagination">
            <span className="dm-table-pager__meta">
              {filtered.length === 0
                ? "0 services"
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
        </div>
      </div>
    </PageShell>
  );
}
