import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import * as dashApi from "@/api/dashboard";
import type { DashboardListItemDTO } from "@/types/dashboard";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type SiteRow = { id: string; name: string };

export function DashboardListPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<DashboardListItemDTO[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await dashApi.listDashboards({
        site_id: siteId || undefined,
        q: q.trim() || undefined,
      });
      setItems(data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "List failed");
    }
  }, [siteId, q]);

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

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  async function onDel(id: string) {
    if (!confirm("Delete this dashboard?")) return;
    setErr(null);
    try {
      await dashApi.deleteDashboard(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function onDup(id: string) {
    setErr(null);
    try {
      const d = await dashApi.duplicateDashboard(id);
      if (d?.id) await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Duplicate failed");
    }
  }

  async function onPrimary(id: string) {
    setErr(null);
    try {
      await dashApi.setPrimaryDashboard(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Set primary failed");
    }
  }

  return (
    <PageShell title="Dashboards">
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Operational dashboards bind to <code>data_object</code> and <code>result_object</code> only. Freeze before live
        view; set one dashboard as your Enterprise landing.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onSearch} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
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
          Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" style={inp} />
        </label>
        <button type="submit" style={btn}>
          Apply
        </button>
        <Link to="/dashboard/create" style={{ ...btn, textDecoration: "none", alignSelf: "flex-end" }}>
          Create dashboard
        </Link>
      </form>
      <div style={{ overflow: "auto" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Site</th>
              <th style={th}>Status</th>
              <th style={th}>Primary</th>
              <th style={th}>Updated</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td style={td}>{row.name}</td>
                <td style={{ ...td, color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                  {row.site_id ? row.site_id.slice(0, 8) + "…" : "—"}
                </td>
                <td style={td}>{row.status}</td>
                <td style={td}>{row.is_primary ? "Yes" : "—"}</td>
                <td style={{ ...td, color: "var(--color-text-muted)" }}>{new Date(row.updated_at).toLocaleString()}</td>
                <td style={td}>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    <Link to={`/dashboard/${row.id}/live`}>Live</Link>
                    <Link to={`/dashboard/${row.id}/edit`}>Edit</Link>
                    <button type="button" style={linkBtn} onClick={() => void onDup(row.id)}>
                      Duplicate
                    </button>
                    <button type="button" style={linkBtn} onClick={() => void onPrimary(row.id)}>
                      Set primary
                    </button>
                    <button type="button" style={{ ...linkBtn, color: "#f66" }} onClick={() => void onDel(row.id)}>
                      Delete
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p style={{ marginTop: "1rem", color: "var(--color-text-muted)" }}>No dashboards.</p>}
      </div>
    </PageShell>
  );
}

const lbl: CSSProperties = { display: "grid", gap: "0.25rem", fontSize: "0.85rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.45rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  minWidth: "160px",
};
const btn: CSSProperties = {
  padding: "0.55rem 0.85rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-end",
};
const linkBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-accent)",
  cursor: "pointer",
  padding: 0,
  font: "inherit",
  textDecoration: "underline",
};
const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = { textAlign: "left", borderBottom: "1px solid var(--color-border)", padding: "0.4rem" };
const td: CSSProperties = { borderBottom: "1px solid var(--color-border)", padding: "0.4rem", verticalAlign: "top" };
