import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import {
  clearOperationalData,
  getOperationalClearJob,
  type OperationalClearJobStatus,
  type TenantOperationalDataClearJobAccepted,
} from "@/api/administration";
import { isApiHttpError } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

const PHRASE = "DELETE ALL DATA EXCEPT SITES";

function isJobAccepted(
  x: unknown,
): x is TenantOperationalDataClearJobAccepted {
  return (
    typeof x === "object" &&
    x !== null &&
    "job_id" in x &&
    typeof (x as TenantOperationalDataClearJobAccepted).job_id === "string"
  );
}

async function pollUntilDone(
  jobId: string,
  onTick?: (st: OperationalClearJobStatus) => void,
): Promise<Record<string, number>> {
  for (;;) {
    const st = await getOperationalClearJob(jobId);
    if (!st) {
      throw new Error("Clear job status unavailable. The job may have expired; please retry.");
    }
    onTick?.(st);
    if (st.status === "completed") return st.deleted_counts ?? {};
    if (st.status === "failed") throw new Error(st.error || "Clear job failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export function AdminClearOperationalDataPage() {
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [runInBackground, setRunInBackground] = useState(true);
  const [jobPhase, setJobPhase] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSummary(null);
    setJobPhase(null);
    setBusy(true);
    try {
      const trimmed = phrase.trim();
      if (trimmed !== PHRASE) {
        setErr(
          `Confirmation phrase must match exactly (case-sensitive): ${PHRASE}. Check for typos or extra spaces.`,
        );
        return;
      }
      if (runInBackground) {
        const acc = await clearOperationalData(password, trimmed, { asyncExecution: true });
        if (!isJobAccepted(acc)) {
          setErr("Unexpected response from server for async clear.");
          return;
        }
        setPassword("");
        setPhrase("");
        const counts = await pollUntilDone(acc.job_id, (st) =>
          setJobPhase(`${st.status}: ${st.phase}`),
        );
        setSummary(counts);
        setJobPhase(null);
      } else {
        const data = await clearOperationalData(password, trimmed);
        if (data && "deleted_counts" in data) {
          setSummary(data.deleted_counts ?? {});
        }
        setPassword("");
        setPhrase("");
      }
    } catch (e) {
      if (isApiHttpError(e) && e.status === 400) {
        setErr(
          `${e.message} If you pasted the phrase, try again — it must match: ${PHRASE}`,
        );
      } else if (isApiHttpError(e) && e.status === 503) {
        setErr(
          `${e.message} Try turning off “Run in background” to run a synchronous clear, or ensure Redis is running.`,
        );
      } else {
        setErr(e instanceof Error ? e.message : "Request failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageStatus variant="warning" icon>
        <strong>Irreversible for this tenant.</strong> Removes devices, raw samples, data objects,
        observed detail history, workflows (including workflow result objects), dashboards, published
        services, alerts, static ingestion, v2 endpoints and related ingest read models.{" "}
        <strong>Sites, users, and administration settings</strong> (ports, LLM, monitoring) are not removed.
      </PageStatus>

      {err ? (
        <div style={{ marginTop: "1rem" }}>
          <PageStatus variant="error">{err}</PageStatus>
        </div>
      ) : null}

      {jobPhase ? (
        <div style={{ marginTop: "1rem", fontSize: "0.9rem", color: "var(--color-text-muted)" }}>
          Background clear: <code>{jobPhase}</code> (this page will update when finished; safe to leave
          and return).
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
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={runInBackground}
            onChange={(e) => setRunInBackground(e.target.checked)}
            disabled={busy}
          />
          <span>
            Run in background <span style={{ color: "var(--color-text-muted)" }}>(recommended)</span>
          </span>
        </label>
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
