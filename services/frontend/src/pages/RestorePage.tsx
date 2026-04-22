import { FormEvent, useState } from "react";
import { apiFetch } from "@/api/client";
import { dbg } from "@/lib/debug";
import { PageShell } from "@/layouts/PageShell";

const PHRASE = "RESET AAR-IOT-STUDIO";

export function RestorePage() {
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    dbg("RestorePage submit", { phraseLen: phrase.length });
    try {
      const data = await apiFetch<unknown>("/administration/restore", {
        method: "POST",
        json: { password, confirmation_phrase: phrase },
      });
      setResult(data === null ? "OK" : JSON.stringify(data));
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <PageShell>
      <p style={{ marginBottom: "1rem", color: "var(--color-text-muted)" }}>
        Phase 1: <strong>full deployment reset</strong> only (§0.7). Requires password + exact phrase{" "}
        <code>{PHRASE}</code>. Backend orchestration is not implemented yet — expect 501 after phrase
        validation.
      </p>
      <form
        onSubmit={onSubmit}
        style={{
          display: "grid",
          gap: "0.75rem",
          maxWidth: "420px",
          marginTop: "1rem",
        }}
      >
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>Admin password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "0.5rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              fontFamily: "inherit",
            }}
          />
        </label>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
            Type: {PHRASE}
          </span>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            style={{
              padding: "0.5rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-text)",
              fontFamily: "inherit",
            }}
          />
        </label>
        <button
          type="submit"
          style={{
            padding: "0.65rem",
            border: "none",
            borderRadius: "var(--radius)",
            background: "#b44",
            color: "#fff",
            fontFamily: "inherit",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Request full reset
        </button>
      </form>
      {result && (
        <pre
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            background: "var(--color-bg)",
            borderRadius: "var(--radius)",
            fontSize: "0.85rem",
            overflow: "auto",
            maxHeight: "120px",
          }}
        >
          {result}
        </pre>
      )}
    </PageShell>
  );
}
