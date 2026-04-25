import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, X } from "lucide-react";
import { apiFetch } from "@/api/client";
import { acknowledgeAlert, acknowledgeAllAlerts, getAlert, listAlerts, type AlertRow } from "@/api/alerts";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { PageStatus } from "@/components/PageStatus";
import { useAlertsModal } from "@/contexts/AlertsModalContext";
import { useConfirmAction } from "@/contexts/ConfirmActionContext";
import { useOpsShellOptional } from "@/contexts/OpsShellContext";
import { AppIcon, ICON_SIZES, ICON_STROKE_WIDTH } from "@/lib/appIcons";

type SiteOpt = { id: string; name: string };

function sevColor(s: string) {
  const x = s.toLowerCase();
  if (x === "critical") return "#c62828";
  if (x === "warning") return "#f9a825";
  if (x === "info") return "#64b5f6";
  return "var(--color-text-muted)";
}

function sevIconName(s: string) {
  const x = s.toLowerCase();
  if (x === "critical") return "offline";
  if (x === "warning") return "degraded";
  if (x === "info") return "online";
  return "alert";
}

const CATEGORIES = [
  "",
  "ingest",
  "scrubber",
  "workflow",
  "publish",
  "dashboard",
  "monitoring",
  "ai",
  "device_health",
  "system",
] as const;

export function UnifiedAlertsModal() {
  const confirm = useConfirmAction();
  const { isOpen, detailId, close, backToList, openDetail } = useAlertsModal();
  const opsShell = useOpsShellOptional();
  const navigate = useNavigate();
  const location = useLocation();

  const [items, setItems] = useState<AlertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [siteId, setSiteId] = useState("");
  const [ackFilter, setAckFilter] = useState<"all" | "open" | "acked">("open");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [listErr, setListErr] = useState<string | null>(null);
  const [listInfo, setListInfo] = useState<string | null>(null);
  const [ackingAll, setAckingAll] = useState(false);

  const [row, setRow] = useState<AlertRow | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const sitesById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sites) m[s.id] = s.name;
    return m;
  }, [sites]);

  function siteDisplayName(siteId: string | null | undefined): string {
    if (!siteId) return "—";
    return sitesById[siteId] ?? `${siteId.slice(0, 8)}…`;
  }

  /** Platform tenant site where the device is registered (ingest), not only the alert row site_id. */
  function platformSiteLabel(a: AlertRow): string {
    const n = a.platform_site_name?.trim();
    if (n) return n;
    const sid = a.platform_site_id ?? a.site_id;
    return siteDisplayName(sid);
  }

  function platformSiteIdForTitle(a: AlertRow): string | undefined {
    const sid = a.platform_site_id ?? a.site_id;
    return sid ?? undefined;
  }

  const alertColumns = useMemo<PlainOperationalColumn<AlertRow>[]>(() => {
    return [
      {
        id: "severity",
        header: "Severity",
        cell: (a) => {
          const s = a.severity ?? "";
          return (
            <span style={{ color: sevColor(s), fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <AppIcon name={sevIconName(s)} size="table" aria-hidden />
              {s}
            </span>
          );
        },
      },
      { id: "category", header: "Category", cell: (a) => a.category },
      {
        id: "site",
        header: "Site (platform)",
        headerTitle: "Platform tenant site",
        cell: (a) => (
          <span title={platformSiteIdForTitle(a)}>{platformSiteLabel(a)}</span>
        ),
      },
      {
        id: "device_id",
        header: "Device",
        cell: (a) => {
          const id = a.device_id;
          return id ? `${id.slice(0, 8)}…` : "—";
        },
      },
      { id: "title", header: "Title", cell: (a) => a.title },
      {
        id: "message",
        header: "Message",
        cell: (a) => (
          <small style={{ display: "block", maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis" }}>
            {a.message || "—"}
          </small>
        ),
      },
      {
        id: "source_component",
        header: "Source",
        cell: (a) => String(a.source_component ?? "—"),
      },
      {
        id: "created_at",
        header: "Time",
        cell: (a) => {
          const v = a.created_at;
          return v ? new Date(v).toLocaleString() : "—";
        },
      },
      {
        id: "acknowledged",
        header: "Ack",
        cell: (a) => (a.acknowledged ? "Yes" : "No"),
      },
      {
        id: "view",
        header: "",
        cell: (a) => (
          <button
            type="button"
            style={{
              border: "none",
              background: "none",
              padding: 0,
              color: "var(--color-accent)",
              cursor: "pointer",
              font: "inherit",
              textDecoration: "underline",
            }}
            onClick={() => openDetail(a.id)}
          >
            View
          </button>
        ),
      },
    ];
  }, [openDetail, sitesById]);

  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        const siteList = await apiFetch<SiteOpt[]>("/administration/sites");
        setSites(siteList ?? []);
      } catch {
        /* list view also loads sites; detail-only may still need names */
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search, isOpen]);

  const loadList = useCallback(async () => {
    setListErr(null);
    setListInfo(null);
    try {
      const [al, siteList] = await Promise.all([
        listAlerts({
          site_id: siteId || undefined,
          acknowledged: ackFilter === "all" ? undefined : ackFilter === "acked",
          severity: severity || undefined,
          category: category || undefined,
          search: searchDebounced || undefined,
          limit: 200,
        }),
        apiFetch<SiteOpt[]>("/administration/sites"),
      ]);
      setItems(al?.items ?? []);
      setTotal(al?.total ?? 0);
      setSites(siteList ?? []);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Failed to load alerts");
    }
  }, [siteId, ackFilter, severity, category, searchDebounced]);

  useEffect(() => {
    if (!isOpen || detailId) return;
    void loadList();
  }, [isOpen, detailId, loadList]);

  const loadDetail = useCallback(async () => {
    if (!detailId) {
      setRow(null);
      return;
    }
    setDetailErr(null);
    try {
      const a = await getAlert(detailId);
      setRow(a);
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : "Not found");
      setRow(null);
    }
  }, [detailId]);

  useEffect(() => {
    if (!isOpen || !detailId) return;
    void loadDetail();
  }, [isOpen, detailId, loadDetail]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  async function onAck() {
    if (!detailId) return;
    try {
      const a = await acknowledgeAlert(detailId);
      setRow(a);
      opsShell?.triggerRefresh();
      void loadList();
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : "Ack failed");
    }
  }

  async function onAcknowledgeAll() {
    if (ackFilter === "acked") return;
    const ok = await confirm({
      title: "Acknowledge matching alerts?",
      message:
        "Acknowledge up to 500 unacknowledged alerts that match current Site, Severity, Category, and Search filters. Already-acknowledged rows are skipped.",
      confirmLabel: "Acknowledge alerts",
      variant: "warning",
    });
    if (!ok) {
      return;
    }
    setAckingAll(true);
    setListErr(null);
    setListInfo(null);
    try {
      const r = await acknowledgeAllAlerts({
        site_id: siteId || undefined,
        severity: severity || undefined,
        category: category || undefined,
        search: searchDebounced || undefined,
        limit: 500,
      });
      opsShell?.triggerRefresh();
      await loadList();
      setListInfo(`Acknowledged ${(r?.acknowledged_count ?? 0)} alert(s).`);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Acknowledge all failed");
    } finally {
      setAckingAll(false);
    }
  }

  function handleClose() {
    close();
    if (location.pathname.startsWith("/alerts")) {
      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate("/enterprise-dashboard", { replace: true });
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="unified-alerts-modal__backdrop"
      role="presentation"
      style={backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="unified-alerts-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unified-alerts-modal-title"
        style={panel}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={headerRow}>
          <h2 id="unified-alerts-modal-title" style={title}>
            {detailId ? row?.title ?? "Alert" : "Alerts"}
          </h2>
          <button type="button" style={closeBtn} onClick={handleClose} aria-label="Close alerts">
            <X size={ICON_SIZES.header} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
          </button>
        </div>

        {detailId ? (
          <div style={body}>
            <p style={{ marginTop: 0 }}>
              <button type="button" style={linkBtnWithIcon} onClick={backToList}>
                <ArrowLeft size={ICON_SIZES.table} strokeWidth={ICON_STROKE_WIDTH} aria-hidden />
                Back to list
              </button>
            </p>
            {detailErr ? <PageStatus variant="error">{detailErr}</PageStatus> : null}
            {row && (
              <>
                <dl style={dl}>
                  <dt>Severity</dt>
                  <dd>{row.severity}</dd>
                  <dt>Category</dt>
                  <dd>{row.category}</dd>
                  <dt>Site</dt>
                  <dd title={platformSiteIdForTitle(row)}>
                    {row.platform_site_id || row.site_id ? (
                      <>
                        <strong>{platformSiteLabel(row)}</strong>
                        <small style={{ display: "block", color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                          {row.platform_site_id ?? row.site_id}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </dd>
                  <dt>Message</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{row.message || "—"}</dd>
                  <dt>Source</dt>
                  <dd>
                    {row.source_component ?? "—"} / {row.source_object_type ?? "—"} / {row.source_object_id ?? "—"}
                  </dd>
                  <dt>Trace</dt>
                  <dd>{row.trace_id ?? "—"}</dd>
                  <dt>Created</dt>
                  <dd>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</dd>
                  <dt>Acknowledged</dt>
                  <dd>{row.acknowledged ? `Yes (${row.acknowledged_at})` : "No"}</dd>
                </dl>
                {!row.acknowledged && (
                  <button type="button" style={ackBtn} onClick={() => void onAck()}>
                    Acknowledge
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div style={body}>
            {listErr ? <PageStatus variant="error">{listErr}</PageStatus> : null}
            {listInfo ? <PageStatus variant="success">{listInfo}</PageStatus> : null}
            <div style={filters}>
              <label style={lbl}>
                Site
                <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={inp}>
                  <option value="">All permitted</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={lbl}>
                Status
                <select
                  value={ackFilter}
                  onChange={(e) => setAckFilter(e.target.value as typeof ackFilter)}
                  style={inp}
                >
                  <option value="open">Unacknowledged</option>
                  <option value="acked">Acknowledged</option>
                  <option value="all">All</option>
                </select>
              </label>
              <label style={lbl}>
                Severity
                <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={inp}>
                  <option value="">All</option>
                  <option value="critical">critical</option>
                  <option value="warning">warning</option>
                  <option value="info">info</option>
                </select>
              </label>
              <label style={lbl}>
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
                  {CATEGORIES.map((c) => (
                    <option key={c || "all"} value={c}>
                      {c || "All"}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...lbl, minWidth: "200px", flex: "1 1 200px" }}>
                Search
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Title or message"
                  style={inp}
                />
              </label>
              <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", alignSelf: "end" }}>
                {total} total
              </span>
              {ackFilter !== "acked" ? (
                <button
                  type="button"
                  style={ackAllBtn}
                  disabled={ackingAll || total === 0}
                  title="Acknowledge every unacknowledged alert that matches the filters above (batch up to 500)"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void onAcknowledgeAll();
                  }}
                >
                  {ackingAll ? "Acknowledging…" : "Acknowledge all"}
                </button>
              ) : null}
            </div>
            <div className="table-scroll-sticky" style={{ overflow: "auto", borderRadius: "var(--radius)" }}>
              <PlainOperationalTable<AlertRow>
                rows={items}
                columns={alertColumns}
                getRowId={(a) => a.id}
                maxHeight="min(55vh, 520px)"
                bordered
                emptyMessage="No alerts."
                resetPageKey={`${siteId}|${ackFilter}|${severity}|${category}|${searchDebounced}|${items.length}`}
                pagerAriaLabel="Alert list pages"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1200,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  boxSizing: "border-box",
};

const panel: CSSProperties = {
  width: "min(1200px, 100%)",
  maxHeight: "min(90vh, 900px)",
  overflow: "auto",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  borderRadius: "var(--radius-lg, 12px)",
  border: "1px solid var(--color-border)",
  boxShadow: "var(--shadow-glow, 0 14px 36px rgba(0,0,0,0.32))",
  display: "flex",
  flexDirection: "column",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  padding: "0.75rem 1rem",
  borderBottom: "1px solid var(--color-border)",
  flexShrink: 0,
};

const title: CSSProperties = {
  margin: 0,
  fontSize: "1.1rem",
  fontWeight: 600,
};

const closeBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-text-muted)",
  lineHeight: 1,
  cursor: "pointer",
  padding: "0.2rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius)",
};

const body: CSSProperties = {
  padding: "0.75rem 1rem 1rem",
  minHeight: 0,
};

const filters: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
  marginBottom: "1rem",
  alignItems: "center",
};

const lbl: CSSProperties = { display: "grid", gap: "0.25rem", fontSize: "0.8rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  minWidth: "160px",
};
const dl: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "140px 1fr",
  gap: "0.35rem 1rem",
  fontSize: "0.9rem",
  marginBottom: "1rem",
};

const ackBtn: CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "var(--radius)",
  border: "none",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  cursor: "pointer",
  fontWeight: 600,
};

const ackAllBtn: CSSProperties = {
  ...ackBtn,
  background: "color-mix(in oklab, var(--color-accent) 35%, var(--color-surface-elevated))",
  color: "var(--color-text)",
  border: "1px solid color-mix(in oklab, var(--color-accent) 45%, var(--color-border))",
  alignSelf: "end",
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

const linkBtnWithIcon: CSSProperties = {
  ...linkBtn,
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  textDecoration: "none",
};
