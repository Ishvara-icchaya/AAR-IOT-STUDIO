import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getPublishedServiceDetail,
  type DeliveryLogRow,
  type PublishedServiceRow,
} from "@/api/publishedServices";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

export function PublishedServiceDetailPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const [svc, setSvc] = useState<PublishedServiceRow | null>(null);
  const [logs, setLogs] = useState<DeliveryLogRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!serviceId) return;
    void (async () => {
      setErr(null);
      try {
        const d = await getPublishedServiceDetail(serviceId, 150);
        if (d) {
          setSvc(d.service);
          setLogs(d.delivery_logs ?? []);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [serviceId]);

  return (
    <PageShell style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <p>
        <Link to="/published-services" style={{ color: "var(--color-accent)" }}>
          ← Published services
        </Link>
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {svc && (
        <>
          <h1 style={{ margin: "0 0 0.5rem", fontSize: "var(--page-title-size)", fontWeight: 700, letterSpacing: "-0.02em" }}>
            {svc.name}
          </h1>
          <p style={{ fontSize: "0.88rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
            {svc.description || "—"} · {svc.publish_protocol} ·{" "}
            <strong>{svc.status}</strong> · source {svc.source_type}: {svc.source_object_name}
          </p>
          {svc.last_error_message && (
            <p style={{ fontSize: "0.85rem", color: "#ffcdd2", marginBottom: "1rem" }}>
              Last error: {svc.last_error_message}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.25rem" }}>
            <Link to={`/published-services/${svc.id}/edit`} style={linkBtn}>
              Edit
            </Link>
            <Link to={`/published-services/${svc.id}/test`} style={linkBtn}>
              Test
            </Link>
          </div>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Delivery logs</h2>
          <div
            className="table-scroll-sticky"
            style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}
          >
            <DeliveryLogsGrid logs={logs} />
          </div>
        </>
      )}
    </PageShell>
  );
}

function DeliveryLogsGrid({ logs }: { logs: DeliveryLogRow[] }) {
  const columns = useMemo<PlainOperationalColumn<DeliveryLogRow>[]>(
    () => [
      {
        id: "published_at",
        header: "Time",
        cell: (r) => new Date(r.published_at).toLocaleString(),
      },
      { id: "status", header: "Status", cell: (r) => r.status },
      {
        id: "response_code",
        header: "Code",
        cell: (r) => String(r.response_code ?? "—"),
      },
      {
        id: "response_message",
        header: "Message",
        cell: (r) => <small style={{ whiteSpace: "pre-wrap" }}>{r.response_message ?? "—"}</small>,
      },
      {
        id: "trace_id",
        header: "Trace",
        cell: (r) => String(r.trace_id ?? "—"),
      },
    ],
    [],
  );
  return (
    <PlainOperationalTable<DeliveryLogRow>
      rows={logs}
      columns={columns}
      getRowId={(r) => r.id}
      bordered
      emptyMessage="No delivery attempts yet."
    />
  );
}

const linkBtn: CSSProperties = {
  padding: "0.35rem 0.65rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-accent)",
  textDecoration: "none",
  fontSize: "0.85rem",
};
