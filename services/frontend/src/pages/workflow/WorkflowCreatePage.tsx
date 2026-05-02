import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, isApiHttpError } from "@/api/client";
import * as wfApi from "@/api/workflow";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

import "../device-register-page.css";

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
      setErr(describeWorkflowCreateError(e2));
    }
  }

  return (
    <PageShell variant="list" className="device-manage-page">
      <div className="dm-root">
        <nav
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.82rem",
            marginBottom: "0.75rem",
            paddingBottom: "0.5rem",
            borderBottom: "1px solid var(--dm-border, rgba(255, 255, 255, 0.08))",
          }}
          aria-label="Workflows"
        >
          <Link
            to="/workflow/list"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              fontWeight: 600,
              color: "var(--dm-accent-blue, var(--color-accent))",
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={18} strokeWidth={2} aria-hidden />
            Workflows
          </Link>
          <span style={{ color: "var(--dm-muted, var(--color-text-muted))" }} aria-hidden>
            /
          </span>
          <span style={{ color: "var(--dm-text, var(--color-text))", fontWeight: 600 }}>Create workflow</span>
          <span style={{ color: "var(--dm-muted, var(--color-text-muted))" }}>
            — pick a site and name, then open the editor.
          </span>
        </nav>

        <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem", maxWidth: "420px", marginTop: "1rem" }}>
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
        <button type="submit" className="dm-btn dm-btn--primary" style={{ justifySelf: "start" }}>
          Create draft
        </button>
      </form>
      </div>
    </PageShell>
  );
}

function describeWorkflowCreateError(e: unknown): string {
  if (isApiHttpError(e)) {
    const m = e.message.trim();
    if (m) return m;
    return `Request failed (${e.status})`;
  }
  if (e instanceof Error && e.message.trim()) return e.message;
  return "Create failed — check site access and try again.";
}

const lbl: CSSProperties = { display: "grid", gap: "0.35rem", fontSize: "0.85rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};
