import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as wfApi from "@/api/workflow";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function WorkflowLivePage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [execJson, setExecJson] = useState<string>("");
  const [resJson, setResJson] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workflowId) return;
    setErr(null);
    try {
      const [ex, ro] = await Promise.all([wfApi.listExecutions(workflowId), wfApi.listResultObjects(workflowId)]);
      setExecJson(JSON.stringify(ex?.items ?? [], null, 2));
      setResJson(JSON.stringify(ro?.items ?? [], null, 2));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workflowId) {
    return <PageShell>Missing id.</PageShell>;
  }

  return (
    <PageShell>
      <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.75rem" }}>
        <Link to={`/workflow/${workflowId}/edit`}>← Editor</Link>
        <button type="button" style={btn} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p style={{ fontSize: "0.88rem", color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>
        Recent executions and <code>workflow_result_objects</code> written by worker-workflow.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <h3 style={{ fontSize: "0.95rem" }}>Executions</h3>
      <pre style={pre}>{execJson || "—"}</pre>
      <h3 style={{ fontSize: "0.95rem", marginTop: "1rem" }}>Result objects</h3>
      <pre style={pre}>{resJson || "—"}</pre>
    </PageShell>
  );
}

const pre: CSSProperties = {
  padding: "0.75rem",
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  fontSize: "0.78rem",
  overflow: "auto",
  maxHeight: "320px",
};
const btn: CSSProperties = {
  padding: "0.4rem 0.75rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-border)",
  cursor: "pointer",
  fontWeight: 600,
};
