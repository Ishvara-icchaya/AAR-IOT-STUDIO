import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import { clearOperationalData } from "@/api/administration";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

const PHRASE = "DELETE ALL DATA EXCEPT SITES";

export function AdminClearOperationalDataPage() {
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSummary(null);
    setBusy(true);
    try {
      const data = await clearOperationalData(password, phrase);
      setSummary(data?.deleted_counts ?? {});
      setPassword("");
      setPhrase("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageStatus variant="warning" icon>
        <strong>Irreversible for this tenant.</strong> Removes devices, raw samples, data objects, workflows
        (including workflow result objects), dashboards, published services, alerts, and static ingestion
        configuration. <strong>Sites, users, and administration settings</strong> (ports, LLM, monitoring) are
        not removed.
      </PageStatus>

      {err ? (
        <div style={{ marginTop: "1rem" }}>
          <PageStatus variant="error">{err}</PageStatus>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        style={{
          display: "grid",
          gap: "0.75rem",
          maxWidth: "440px",
          marginTop: "1.25rem",
        }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>Your admin password</span>
          <input
            type="password"
            value={password}
            required
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            style={inp}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
            Type exactly (case-sensitive): <code style={{ userSelect: "all" }}>{PHRASE}</code>
          </span>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={inp}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "0.65rem",
            border: "none",
            borderRadius: "var(--radius)",
            background: busy ? "var(--color-border)" : "#b44",
            color: "#fff",
            fontFamily: "inherit",
            fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Clearing…" : "Clear all operational data"}
        </button>
      </form>

      {summary ? (
        <div style={{ marginTop: "1.25rem" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Deleted row counts</p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem", color: "var(--color-text-muted)" }}>
            {Object.entries(summary).map(([k, v]) => (
              <li key={k}>
                <code>{k}</code>: {v}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
