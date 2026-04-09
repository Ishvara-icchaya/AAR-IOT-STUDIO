import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAlerts, type AlertRow } from "@/api/alerts";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import { apiFetch } from "@/api/client";

type SiteOpt = { id: string; name: string };

function sevColor(s: string) {
  const x = s.toLowerCase();
  if (x === "critical") return "#c62828";
  if (x === "warning") return "#f9a825";
  if (x === "info") return "#64b5f6";
  return "var(--color-text-muted)";
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

export function AlertsNotificationsPage() {
  const [items, setItems] = useState<AlertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [siteId, setSiteId] = useState("");
  const [ackFilter, setAckFilter] = useState<"all" | "open" | "acked">("open");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  async function load() {
    setErr(null);
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
      setErr(e instanceof Error ? e.message : "Failed to load alerts");
    }
  }

  useEffect(() => {
    void load();
  }, [siteId, ackFilter, severity, category, searchDebounced]);

  return (
    <PageShell title="Alerts" style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
        <label style={lbl}>
          Site
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            style={inp}
          >
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
        <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>{total} total</span>
      </div>
      <div style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Severity</th>
              <th style={th}>Category</th>
              <th style={th}>Site</th>
              <th style={th}>Device</th>
              <th style={th}>Title</th>
              <th style={th}>Message</th>
              <th style={th}>Source</th>
              <th style={th}>Time</th>
              <th style={th}>Ack</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td style={td}>
                  <span style={{ color: sevColor(a.severity), fontWeight: 600 }}>{a.severity}</span>
                </td>
                <td style={td}>{a.category}</td>
                <td style={td}>{a.site_id ? a.site_id.slice(0, 8) + "…" : "—"}</td>
                <td style={td}>{a.device_id ? a.device_id.slice(0, 8) + "…" : "—"}</td>
                <td style={td}>{a.title}</td>
                <td style={td}>
                  <small style={{ display: "block", maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.message || "—"}
                  </small>
                </td>
                <td style={td}>
                  <small>{a.source_component ?? "—"}</small>
                </td>
                <td style={td}>
                  <small>{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</small>
                </td>
                <td style={td}>{a.acknowledged ? "Yes" : "No"}</td>
                <td style={td}>
                  <Link to={`/alerts/${a.id}`} style={{ color: "var(--color-accent)" }}>
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <p style={{ padding: "1rem", color: "var(--color-text-muted)" }}>No alerts.</p>
        )}
      </div>
    </PageShell>
  );
}

const lbl: CSSProperties = { display: "grid", gap: "0.25rem", fontSize: "0.8rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  minWidth: "160px",
};
const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
};
const td: CSSProperties = { padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--color-border)", verticalAlign: "top" };
