import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deletePublishedService,
  listPublishedServices,
  restartPublishedService,
  startPublishedService,
  stopPublishedService,
  type PublishedServiceRow,
} from "@/api/publishedServices";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type SiteOpt = { id: string; name: string };

export function PublishedServicesListPage() {
  const [items, setItems] = useState<PublishedServiceRow[]>([]);
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState("");
  const [protocol, setProtocol] = useState("");
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
      const [data, siteList] = await Promise.all([
        listPublishedServices({
          site_id: siteId || undefined,
          status: status || undefined,
          publish_protocol: protocol || undefined,
          search: searchDebounced || undefined,
        }),
        apiFetch<SiteOpt[]>("/administration/sites"),
      ]);
      setItems(data?.items ?? []);
      setSites(siteList ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, [siteId, status, protocol, searchDebounced]);

  async function onStartStop(id: string, action: "start" | "stop" | "restart") {
    try {
      if (action === "start") await startPublishedService(id);
      else if (action === "stop") await stopPublishedService(id);
      else await restartPublishedService(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this published service?")) return;
    try {
      await deletePublishedService(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <PageShell
      title="Published services"
      className="published-services-page--full"
      style={{ width: "100%", maxWidth: "none", flex: 1, minHeight: 0 }}
      actions={
        <Link to="/published-services/create" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
          Create
        </Link>
      }
    >
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
      <div style={{ flexShrink: 0, marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
        <label style={lbl}>
          Site
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={inp}>
            <option value="">All</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={lbl}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
            <option value="">All</option>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="stopped">stopped</option>
            <option value="failed">failed</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <label style={lbl}>
          Protocol
          <select value={protocol} onChange={(e) => setProtocol(e.target.value)} style={inp}>
            <option value="">All</option>
            <option value="mqtt">mqtt</option>
            <option value="rest">rest</option>
          </select>
        </label>
        <label style={{ ...lbl, minWidth: "200px", flex: "1 1 200px" }}>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Service or object name"
            style={inp}
          />
        </label>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          marginTop: "1rem",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
        }}
      >
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Site</th>
              <th style={th}>Source</th>
              <th style={th}>Object</th>
              <th style={th}>Protocol</th>
              <th style={th}>Status</th>
              <th style={th}>Last published</th>
              <th style={th}>Last error</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td style={td}>{s.name}</td>
                <td style={td}>
                  <small>{s.site_id.slice(0, 8)}…</small>
                </td>
                <td style={td}>{s.source_type}</td>
                <td style={td}>{s.source_object_name}</td>
                <td style={td}>{s.publish_protocol}</td>
                <td style={td}>{s.status}</td>
                <td style={td}>
                  <small>{s.last_published_at ? new Date(s.last_published_at).toLocaleString() : "—"}</small>
                </td>
                <td style={td}>
                  <small style={{ color: s.last_error_message ? "#c62828" : undefined }}>
                    {s.last_error_message ? s.last_error_message.slice(0, 80) : "—"}
                  </small>
                </td>
                <td style={td}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                    <Link to={`/published-services/${s.id}`} style={link}>
                      View
                    </Link>
                    <button type="button" style={sbtn} onClick={() => void onStartStop(s.id, "start")}>
                      Start
                    </button>
                    <button type="button" style={sbtn} onClick={() => void onStartStop(s.id, "stop")}>
                      Stop
                    </button>
                    <button type="button" style={sbtn} onClick={() => void onStartStop(s.id, "restart")}>
                      Restart
                    </button>
                    <Link to={`/published-services/${s.id}/edit`} style={link}>
                      Edit
                    </Link>
                    <Link to={`/published-services/${s.id}/test`} style={link}>
                      Test
                    </Link>
                    <button type="button" style={sbtn} onClick={() => void onDelete(s.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p style={{ padding: "1rem", color: "var(--color-text-muted)" }}>No services.</p>}
      </div>
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
  minWidth: "200px",
};
const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
};
const td: CSSProperties = { padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--color-border)", verticalAlign: "top" };
const btn: CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontWeight: 600,
};
const link: CSSProperties = { color: "var(--color-accent)", fontSize: "0.8rem" };
const sbtn: CSSProperties = {
  padding: "0.2rem 0.35rem",
  fontSize: "0.75rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  cursor: "pointer",
};
