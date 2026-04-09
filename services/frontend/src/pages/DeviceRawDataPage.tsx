import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type RawRow = {
  id: string;
  device_id: string;
  device_name: string;
  site_id: string;
  site_name: string;
  protocol_source: string | null;
  captured_at: string | null;
  ingested_at: string;
  size_bytes: number | null;
};

type ListResp = { items: RawRow[]; total: number };

type AggregatedGroup = {
  device_id: string;
  object_name: string;
  site_id: string;
  site_name: string;
  archive_count: number;
  latest_ingested_at: string;
  latest_raw_id: string;
  protocol_source: string | null;
};

type RawPreview = {
  raw_object_id: string;
  offset: number;
  requested_max_bytes: number;
  total_size: number | null;
  returned_bytes: number;
  truncated: boolean;
  content_type: string | null;
  encoding: "utf8" | "base64";
  text: string | null;
  base64: string | null;
};

function aggregateByObjectName(rows: RawRow[]): AggregatedGroup[] {
  const map = new Map<string, AggregatedGroup>();
  for (const r of rows) {
    const key = r.device_id;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        device_id: r.device_id,
        object_name: r.device_name || "—",
        site_id: r.site_id,
        site_name: r.site_name,
        archive_count: 1,
        latest_ingested_at: r.ingested_at,
        latest_raw_id: r.id,
        protocol_source: r.protocol_source,
      });
      continue;
    }
    cur.archive_count += 1;
    if (new Date(r.ingested_at).getTime() > new Date(cur.latest_ingested_at).getTime()) {
      cur.latest_ingested_at = r.ingested_at;
      cur.latest_raw_id = r.id;
      cur.protocol_source = r.protocol_source;
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.latest_ingested_at).getTime() - new Date(a.latest_ingested_at).getTime(),
  );
}

function formatPayloadPreview(text: string, contentType: string | null): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("json") || (text.trim().startsWith("{") && text.trim().endsWith("}"))) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* keep raw */
    }
  }
  return text;
}

export function DeviceRawDataPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busyPayload, setBusyPayload] = useState<string | null>(null);
  const [payloadModal, setPayloadModal] = useState<{
    title: string;
    rawId: string;
    preview: RawPreview | null;
    error: string | null;
  } | null>(null);

  const groups = useMemo(() => aggregateByObjectName(rows), [rows]);

  async function load() {
    setErr(null);
    try {
      const qs = new URLSearchParams({ limit: "200", offset: "0" });
      if (q.trim()) qs.set("q", q.trim());
      const data = await apiFetch<ListResp>(`/raw-data-objects?${qs.toString()}`);
      const items = data?.items ?? [];
      setRows(
        items.map((r) => ({
          id: r.id,
          device_id: r.device_id,
          device_name: r.device_name,
          site_id: r.site_id,
          site_name: r.site_name,
          protocol_source: r.protocol_source,
          captured_at: r.captured_at,
          ingested_at: r.ingested_at,
          size_bytes: r.size_bytes,
        })),
      );
      setTotal(data?.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  async function openPayload(objectName: string, rawId: string) {
    setBusyPayload(rawId);
    setPayloadModal({ title: objectName, rawId, preview: null, error: null });
    try {
      const prev = await apiFetch<RawPreview>(
        `/raw-data-objects/${encodeURIComponent(rawId)}/preview?max_bytes=262144`,
      );
      setPayloadModal({ title: objectName, rawId, preview: prev ?? null, error: null });
    } catch (e) {
      setPayloadModal({
        title: objectName,
        rawId,
        preview: null,
        error: e instanceof Error ? e.message : "Failed to load payload",
      });
    } finally {
      setBusyPayload(null);
    }
  }

  function closePayloadModal() {
    setPayloadModal(null);
  }

  return (
    <PageShell title="Raw Data">
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Rows are <strong>aggregated by object name</strong> (registered device). Each line summarizes all raw archives for
        that device; <strong>View payload</strong> loads the <em>latest</em> archive for that device from MinIO. Canonical
        SoT: Postgres <code>raw_data_objects</code> + MinIO.
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onSearch} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...inp, flex: "1 1 200px" }}
        />
        <button type="submit" style={btn}>
          Search
        </button>
        <button type="button" style={sbtn} onClick={() => void load()}>
          Refresh
        </button>
      </form>
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
        Total raw archives (tenant filter): {total}
        {rows.length < total ? (
          <span>
            {" "}
            — aggregates built from the {rows.length} most recent rows returned by the API (limit 200).
          </span>
        ) : null}
      </p>
      <div style={{ overflow: "auto", marginTop: "0.5rem" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Object name</th>
              <th style={th}>Site</th>
              <th style={th}>Archives</th>
              <th style={th}>Latest ingested</th>
              <th style={th}>Protocol</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.device_id}>
                <td style={td}>{g.object_name}</td>
                <td style={td}>{g.site_name}</td>
                <td style={td}>{g.archive_count}</td>
                <td style={td}>{fmt(g.latest_ingested_at)}</td>
                <td style={td}>{g.protocol_source ?? "—"}</td>
                <td style={td}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                    <button
                      type="button"
                      style={sbtn}
                      disabled={busyPayload !== null}
                      onClick={() => void openPayload(g.object_name, g.latest_raw_id)}
                    >
                      {busyPayload === g.latest_raw_id ? "Loading…" : "View payload"}
                    </button>
                    <Link
                      to={`/scrubber/create?rawId=${encodeURIComponent(
                        g.latest_raw_id,
                      )}&deviceId=${encodeURIComponent(g.device_id)}&returnTo=${encodeURIComponent("/devices/raw")}`}
                      style={{ fontSize: "0.8rem" }}
                    >
                      Scrubber
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && (
          <p style={{ marginTop: "0.75rem", color: "var(--color-text-muted)" }}>No rows.</p>
        )}
      </div>

      {payloadModal ? (
        <div style={modalBackdrop} onClick={closePayloadModal} role="presentation">
          <div
            style={modalPanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="raw-payload-title"
          >
            <div style={modalHeader}>
              <h2 id="raw-payload-title" style={modalTitle}>
                Payload — {payloadModal.title}
              </h2>
              <button type="button" style={modalClose} onClick={closePayloadModal} aria-label="Close">
                ×
              </button>
            </div>
            <p style={modalMeta}>
              <code style={{ fontSize: "0.72rem" }}>{payloadModal.rawId}</code>
            </p>
            {payloadModal.error ? <PageStatus variant="error">{payloadModal.error}</PageStatus> : null}
            {payloadModal.preview ? (
              <>
                {payloadModal.preview.truncated ? (
                  <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                    Showing first {payloadModal.preview.returned_bytes} of{" "}
                    {payloadModal.preview.total_size ?? "?"} bytes (truncated).
                  </p>
                ) : null}
                <pre style={prePayload}>
                  {payloadModal.preview.encoding === "utf8" && payloadModal.preview.text != null
                    ? formatPayloadPreview(payloadModal.preview.text, payloadModal.preview.content_type)
                    : payloadModal.preview.encoding === "base64" && payloadModal.preview.base64
                      ? `[binary base64, ${payloadModal.preview.base64.length} chars]\n${payloadModal.preview.base64.slice(0, 8000)}${payloadModal.preview.base64.length > 8000 ? "…" : ""}`
                      : "—"}
                </pre>
              </>
            ) : !payloadModal.error ? (
              <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const inp: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
};

const btn: CSSProperties = {
  padding: "0.55rem 0.85rem",
  border: "none",
  borderRadius: "var(--radius)",
  background: "var(--color-accent)",
  color: "#fff",
  fontFamily: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

const sbtn: CSSProperties = {
  padding: "0.3rem 0.45rem",
  fontSize: "0.75rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const tbl: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.82rem",
};

const th: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid var(--color-border)",
  padding: "0.4rem",
  whiteSpace: "nowrap",
};

const td: CSSProperties = {
  borderBottom: "1px solid var(--color-border)",
  padding: "0.4rem",
  verticalAlign: "top",
};

const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
};

const modalPanel: CSSProperties = {
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  maxWidth: "min(920px, 100%)",
  maxHeight: "min(85vh, 100%)",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
};

const modalHeader: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "0.5rem",
  padding: "0.75rem 1rem",
  borderBottom: "1px solid var(--color-border)",
};

const modalTitle: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  fontWeight: 600,
};

const modalClose: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-text-muted)",
  fontSize: "1.5rem",
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 0.25rem",
};

const modalMeta: CSSProperties = {
  margin: "0.35rem 1rem 0",
  fontSize: "0.72rem",
  color: "var(--color-text-muted)",
};

const prePayload: CSSProperties = {
  margin: "0.75rem 1rem 1rem",
  padding: "0.65rem",
  overflow: "auto",
  flex: 1,
  minHeight: 0,
  fontSize: "0.78rem",
  lineHeight: 1.45,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "4px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
