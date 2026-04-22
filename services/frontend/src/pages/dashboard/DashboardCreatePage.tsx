import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/api/client";
import * as dashApi from "@/api/dashboard";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type SiteRow = { id: string; name: string };

const lbl: CSSProperties = { display: "grid", gap: "0.25rem", fontSize: "0.85rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.45rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  minWidth: "240px",
};
const btn: CSSProperties = {
  padding: "0.55rem 0.85rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  fontWeight: 600,
  cursor: "pointer",
};

export function DashboardCreatePage() {
  const nav = useNavigate();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch<SiteRow[]>("/administration/sites");
        setSites(data ?? []);
        if (data?.length === 1) setSiteId(data[0].id);
      } catch {
        setSites([]);
      }
    })();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!siteId || !name.trim()) {
      setErr("Site and name are required.");
      return;
    }
    setErr(null);
    try {
      const d = await dashApi.createDashboard({
        site_id: siteId,
        name: name.trim(),
        description: description.trim() || null,
      });
      if (d?.id) nav(`/dashboard/${d.id}/edit`, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    }
  }

  return (
    <PageShell>
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        New dashboards start as <strong>draft</strong> with the default Operations Overview layout. Adjust in the
        editor, then freeze for live use.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem", maxWidth: "28rem" }}>
        <label style={lbl}>
          Site
          <select required value={siteId} onChange={(e) => setSiteId(e.target.value)} style={inp}>
            <option value="">Select site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={lbl}>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} style={inp} />
        </label>
        <label style={lbl}>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inp, minHeight: "4rem" }} />
        </label>
        <button type="submit" style={{ ...btn, justifySelf: "start" }}>
          Create and open editor
        </button>
      </form>
    </PageShell>
  );
}
