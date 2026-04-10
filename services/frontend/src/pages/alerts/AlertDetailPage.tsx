import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { acknowledgeAlert, getAlert, type AlertRow } from "@/api/alerts";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function AlertDetailPage() {
  const { alertId } = useParams<{ alertId: string }>();
  const [row, setRow] = useState<AlertRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!alertId) return;
    setErr(null);
    try {
      const a = await getAlert(alertId);
      setRow(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Not found");
    }
  }

  useEffect(() => {
    void load();
  }, [alertId]);

  async function onAck() {
    if (!alertId) return;
    try {
      const a = await acknowledgeAlert(alertId);
      setRow(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ack failed");
    }
  }

  return (
    <PageShell title={row?.title ?? "Alert"} className="page-shell--use-80">
      <p>
        <Link to="/alerts" style={{ color: "var(--color-accent)" }}>
          ← Alerts
        </Link>
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {row && (
        <>
          <dl style={dl}>
            <dt>Severity</dt>
            <dd>{row.severity}</dd>
            <dt>Category</dt>
            <dd>{row.category}</dd>
            <dt>Message</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{row.message || "—"}</dd>
            <dt>Source</dt>
            <dd>
              {row.source_component ?? "—"} / {row.source_object_type ?? "—"} / {row.source_object_id ?? "—"}
            </dd>
            <dt>Trace</dt>
            <dd>{row.trace_id ?? "—"}</dd>
            <dt>Created</dt>
            <dd>{row.created_at ? new Date(row.created_at).toLocaleString() : "—"}</dd>
            <dt>Acknowledged</dt>
            <dd>{row.acknowledged ? `Yes (${row.acknowledged_at})` : "No"}</dd>
          </dl>
          {!row.acknowledged && (
            <button type="button" style={btn} onClick={() => void onAck()}>
              Acknowledge
            </button>
          )}
        </>
      )}
    </PageShell>
  );
}

const dl: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "140px 1fr",
  gap: "0.35rem 1rem",
  fontSize: "0.9rem",
  marginBottom: "1rem",
};
const btn: CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "var(--radius)",
  border: "none",
  background: "var(--color-accent)",
  color: "var(--btn-on-accent)",
  cursor: "pointer",
  fontWeight: 600,
};
