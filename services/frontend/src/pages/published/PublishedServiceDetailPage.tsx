import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getPublishedServiceDetail,
  type DeliveryLogRow,
  type PublishedServiceRow,
} from "@/api/publishedServices";
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
    <PageShell title={svc?.name ?? "Published service"} style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <p>
        <Link to="/published-services" style={{ color: "var(--color-accent)" }}>
          ← Published services
        </Link>
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {svc && (
        <>
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
          <div style={{ overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={th}>Time</th>
                  <th style={th}>Status</th>
                  <th style={th}>Code</th>
                  <th style={th}>Message</th>
                  <th style={th}>Trace</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>
                      <small>{new Date(r.published_at).toLocaleString()}</small>
                    </td>
                    <td style={td}>{r.status}</td>
                    <td style={td}>
                      <small>{r.response_code ?? "—"}</small>
                    </td>
                    <td style={td}>
                      <small style={{ whiteSpace: "pre-wrap" }}>{r.response_message ?? "—"}</small>
                    </td>
                    <td style={td}>
                      <small>{r.trace_id ?? "—"}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.length === 0 && (
              <p style={{ padding: "1rem", color: "var(--color-text-muted)" }}>No delivery attempts yet.</p>
            )}
          </div>
        </>
      )}
    </PageShell>
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
const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" };
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.45rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
};
const td: CSSProperties = { padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--color-border)", verticalAlign: "top" };
