import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as wfApi from "@/api/workflow";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function WorkflowTestPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setOut(null);
  }, [workflowId]);

  async function run() {
    if (!workflowId) return;
    setErr(null);
    setOut(null);
    try {
      const r = await wfApi.testWorkflow(workflowId, { sample_payload: {} });
      setOut(JSON.stringify(r, null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test failed");
    }
  }

  if (!workflowId) {
    return <PageShell>Missing id.</PageShell>;
  }

  return (
    <PageShell>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to={`/workflow/${workflowId}/edit`}>← Editor</Link>
      </div>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
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

const btn: CSSProperties = {
  padding: "0.55rem 1rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  fontWeight: 600,
  cursor: "pointer",
};
