import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as wfApi from "@/api/workflow";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function WorkflowTestPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [sample, setSample] = useState('{\n  "temperature": 42,\n  "device": "a1"\n}\n');
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setOut(null);
  }, [workflowId]);

  async function run() {
    if (!workflowId) return;
    setErr(null);
    setOut(null);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(sample) as Record<string, unknown>;
    } catch {
      setErr("Sample JSON invalid");
      return;
    }
    try {
      const r = await wfApi.testWorkflow(workflowId, { sample_payload: payload });
      setOut(JSON.stringify(r, null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test failed");
    }
  }

  if (!workflowId) {
    return <PageShell title="Test workflow">Missing id.</PageShell>;
  }

  return (
    <PageShell title="Test workflow">
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to={`/workflow/${workflowId}/edit`}>← Editor</Link>
      </div>
      <p style={{ fontSize: "0.88rem", color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>
        Runs <code>POST /workflows/{"{id}"}/test</code> with <code>sample_payload</code> (bypasses MinIO; same engine as
        worker).
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <label style={lbl}>
        Sample payload (JSON)
        <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={10} style={ta} />
      </label>
      <button type="button" style={btn} onClick={() => void run()}>
        Run test
      </button>
      {out && (
        <pre style={{ marginTop: "1rem", padding: "0.75rem", background: "var(--color-bg)", borderRadius: "var(--radius)", fontSize: "0.78rem", overflow: "auto" }}>
          {out}
        </pre>
      )}
    </PageShell>
  );
}

const lbl: CSSProperties = { display: "grid", gap: "0.35rem", fontSize: "0.85rem", color: "var(--color-text-muted)" };
const ta: CSSProperties = {
  fontFamily: "monospace",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  padding: "0.5rem",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};
const btn: CSSProperties = {
  marginTop: "0.5rem",
  padding: "0.55rem 1rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};
