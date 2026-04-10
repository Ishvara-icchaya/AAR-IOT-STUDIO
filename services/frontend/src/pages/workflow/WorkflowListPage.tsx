import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import * as wfApi from "@/api/workflow";
import { PageStatus } from "@/components/PageStatus";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { PageShell } from "@/layouts/PageShell";
import type { WorkflowListItemDTO } from "@/types/workflow";

type SiteRow = { id: string; name: string };

export function WorkflowListPage() {
  const { siteId: opsSiteId, refreshToken } = useOpsShell();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<WorkflowListItemDTO[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await wfApi.listWorkflows({
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
    if (opsSiteId) setSiteId(opsSiteId);
  }, [opsSiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (refreshToken === 0) return;
    void load();
  }, [refreshToken, load]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  async function onDup(id: string) {
    setErr(null);
    try {
      const w = await wfApi.duplicateWorkflow(id);
      if (w?.id) await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Duplicate failed");
    }
  }

  async function onDel(id: string) {
    if (!confirm("Delete this workflow?")) return;
    setErr(null);
    try {
      await wfApi.deleteWorkflow(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function onPublish(id: string) {
    setErr(null);
    try {
      await wfApi.publishWorkflow(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Publish failed");
    }
  }

  async function onStop(id: string) {
    setErr(null);
    try {
      await wfApi.stopPublishWorkflow(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Stop failed");
    }
  }

  return (
    <PageShell title="Workflows">
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Published workflows consume <strong>published</strong> data_objects via worker-workflow (
        <code>data_object.created</code>).
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
          <input value={q} onChange={(e) => setQ(e.target.value)} style={inp} placeholder="Name" />
        </label>
        <button type="submit" style={btn}>
          Search
        </button>
        <Link to="/workflow/create" style={{ ...btn, textDecoration: "none", alignSelf: "flex-end" }}>
          Create workflow
        </Link>
      </form>
      <div style={{ overflow: "auto" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Status</th>
              <th style={th}>Version</th>
              <th style={th}>Inputs</th>
              <th style={th}>Terminate</th>
              <th style={th}>Updated</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <td style={td}>{w.name}</td>
                <td style={td}>
                  {w.lifecycle_status}
                  {w.is_published ? " · live" : ""}
                </td>
                <td style={td}>{w.version}</td>
                <td style={td}>{w.input_count}</td>
                <td style={td}>{w.terminate_count}</td>
                <td style={td}>{new Date(w.updated_at).toLocaleString()}</td>
                <td style={td}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    <Link to={`/workflow/${w.id}/edit`}>Edit</Link>
                    <Link to={`/workflow/${w.id}/test`}>Test</Link>
                    <Link to={`/workflow/${w.id}/live`}>Live</Link>
                    {!w.is_published ? (
                      <button type="button" style={linkBtn} onClick={() => void onPublish(w.id)}>
                        Publish
                      </button>
                    ) : (
                      <button type="button" style={linkBtn} onClick={() => void onStop(w.id)}>
                        Stop
                      </button>
                    )}
                    <button type="button" style={linkBtn} onClick={() => void onDup(w.id)}>
                      Duplicate
                    </button>
                    <button type="button" style={linkBtn} onClick={() => void onDel(w.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p style={{ color: "var(--color-text-muted)" }}>No workflows.</p>}
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
  color: "var(--btn-on-accent)",
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-end",
  textAlign: "center",
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
