import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/api/client";
import * as wfApi from "@/api/workflow";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type SiteRow = { id: string; name: string };

export function WorkflowCreatePage() {
  const nav = useNavigate();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<SiteRow[]>("/administration/sites");
        setSites(data ?? []);
        if (data?.[0]) setSiteId((p) => p || data[0].id);
      } catch {
        setSites([]);
      }
    })();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!siteId || !name.trim()) {
      setErr("Site and name required");
      return;
    }
    setErr(null);
    try {
      const w = await wfApi.createWorkflow({
        site_id: siteId,
        name: name.trim(),
        nodes: [],
        edges: [],
      });
      if (w?.id) nav(`/workflow/${w.id}/edit`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Create failed");
    }
  }

  return (
    <PageShell>
      <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem", maxWidth: "420px" }}>
        {err ? <PageStatus variant="error">{err}</PageStatus> : null}
        <label style={lbl}>
          Site
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={inp} required>
            <option value="">Select site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={lbl}>
          Workflow name
          <input value={name} onChange={(e) => setName(e.target.value)} style={inp} required />
        </label>
        <button type="submit" style={btn}>
          Create draft
        </button>
      </form>
    </PageShell>
  );
}

const lbl: CSSProperties = { display: "grid", gap: "0.35rem", fontSize: "0.85rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};
const btn: CSSProperties = {
  padding: "0.6rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  fontWeight: 600,
  cursor: "pointer",
  justifySelf: "start",
};
