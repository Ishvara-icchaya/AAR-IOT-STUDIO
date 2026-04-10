import type { CSSProperties } from "react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listDeliveryLogs, testPublishedService } from "@/api/publishedServices";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function PublishedServiceTestPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const [out, setOut] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function runTest() {
    if (!serviceId) return;
    setErr(null);
    setOut(null);
    try {
      const r = await testPublishedService(serviceId);
      setOut(JSON.stringify(r, null, 2));
      const l = await listDeliveryLogs(serviceId, 20);
      setLogs(JSON.stringify(l?.items ?? [], null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test failed");
    }
  }

  return (
    <PageShell title="Test publish" style={{ maxWidth: "720px", margin: "0 auto" }}>
      <p>
        <Link to="/published-services" style={{ color: "var(--color-accent)" }}>
          ← Published services
        </Link>
      </p>
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)" }}>
        Sends the current source payload once using the configured protocol. Writes a delivery log row.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <button type="button" style={btn} onClick={() => void runTest()}>
        Run test
      </button>
      {out && (
        <pre style={pre}>{out}</pre>
      )}
      {logs && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "1rem" }}>Recent delivery logs</h2>
          <pre style={pre}>{logs}</pre>
        </>
      )}
    </PageShell>
  );
}

const btn: CSSProperties = {
  marginTop: "0.75rem",
  padding: "0.5rem 1rem",
  borderRadius: "var(--radius)",
  border: "none",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  fontWeight: 600,
  cursor: "pointer",
};
const pre: CSSProperties = {
  marginTop: "1rem",
  padding: "0.75rem",
  background: "var(--color-surface-elevated)",
  borderRadius: "var(--radius)",
  fontSize: "0.78rem",
  overflow: "auto",
};
