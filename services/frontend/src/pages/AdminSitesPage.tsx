import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type SiteRow = { id: string; name: string; description: string | null };

export function AdminSitesPage() {
  const [items, setItems] = useState<SiteRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function load() {
    setErr(null);
    try {
      const data = await apiFetch<SiteRow[]>("/administration/sites");
      setItems(data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load sites");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch("/administration/sites", {
        method: "POST",
        json: { name, description: description || null },
      });
      setName("");
      setDescription("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed (admin only)");
    }
  }

  return (
    <PageShell title="Create Sites">
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form
        onSubmit={onCreate}
        style={{ display: "grid", gap: "0.5rem", maxWidth: "420px", marginBottom: "1.5rem" }}
      >
        <input
          placeholder="Site name"
          value={name}
          required
          onChange={(e) => setName(e.target.value)}
          style={inp}
        />
        <input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={inp}
        />
        <button type="submit" style={btn}>
          Create site
        </button>
      </form>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((s) => (
          <li
            key={s.id}
            style={{
              padding: "0.5rem 0",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <strong>{s.name}</strong>
            {s.description && (
              <span style={{ color: "var(--color-text-muted)", marginLeft: "0.5rem" }}>
                — {s.description}
              </span>
            )}
          </li>
        ))}
      </ul>
    </PageShell>
  );
}

const inp: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
};

const btn: CSSProperties = {
  padding: "0.6rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};
