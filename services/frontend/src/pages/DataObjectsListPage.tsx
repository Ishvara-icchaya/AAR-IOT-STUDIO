import type { CSSProperties, FormEvent } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

type DeviceRow = { id: string; name: string; site_id: string };

type DataObjectRow = {
  id: string;
  device_id: string;
  raw_data_object_id: string | null;
  name: string;
  payload: Record<string, unknown>;
  kpi_json: Record<string, unknown>;
  health_status: string | null;
  health_code: string | null;
  health_message: string | null;
  scrubber_version: string | null;
  lifecycle_status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type ListResp = { items: DataObjectRow[] };

function healthColor(status: string | null): string {
  const s = (status || "").toLowerCase();
  if (s === "green") return "#2d8a4e";
  if (s === "yellow") return "#b8860b";
  if (s === "red") return "#c62828";
  return "var(--color-text-muted)";
}

/** ISO timestamp → YYYY-MM-DD (UTC) for grouping. */
function dateKeyUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

function formatDateGroupHeading(dateKey: string): string {
  if (dateKey === "unknown") return "Unknown date";
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

type DateGroup = { dateKey: string; heading: string; items: DataObjectRow[] };

function groupRowsByCreatedDate(rows: DataObjectRow[]): DateGroup[] {
  const map = new Map<string, DataObjectRow[]>();
  for (const r of rows) {
    const k = dateKeyUtc(r.created_at);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
  return keys.map((dateKey) => ({
    dateKey,
    heading: formatDateGroupHeading(dateKey),
    items: map.get(dateKey)!,
  }));
}

/** Compiled `data_object` rows produced by the scrubber worker (`GET /scrubber/data-objects`). */
export function DataObjectsListPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [rows, setRows] = useState<DataObjectRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (deviceId) qs.set("device_id", deviceId);
      const data = await apiFetch<ListResp>(`/scrubber/data-objects?${qs.toString()}`, {
        cache: "no-store",
      });
      setRows(data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load data objects");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void (async () => {
      try {
        const d = await apiFetch<{ items: DeviceRow[] }>("/devices");
        setDevices(d?.items ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed devices");
      }
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedByDate = useMemo(() => groupRowsByCreatedDate(rows), [rows]);

  async function onRefresh(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  return (
    <PageShell title="View Data_Objects">
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        <strong>Not the same as Scrubber Studio preview.</strong> “Online” in Studio and <strong>Compile preview</strong>{" "}
        run the transform inside the <strong>API</strong> only — they do <strong>not</strong> insert rows here. This
        table lists rows written by the <strong>worker-scrubber</strong> service after Kafka handoff.
      </p>
      <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        Pipeline: new raw archived → Kafka <code>raw.ingest</code> → <strong>worker-ingest</strong> (must emit{" "}
        <code>scrubber.input</code>, env <code>KAFKA_EMIT_SCRUBBER_INPUT=true</code>) →{" "}
        <strong>worker-scrubber</strong> → Postgres <code>data_objects</code>. Publish/save mapping in Studio only
        updates config; the next ingested raw after that triggers a new row. If this list stays empty while ingest works,
        check both workers are running and <code>worker-ingest</code> logs for <code>scrubber_input_emitted</code> /{" "}
        <code>worker-scrubber</code> for <code>data_object_insert</code>.
      </p>
      <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        To preview transforms against archived raw bytes, use{" "}
        <Link to="/scrubber/raw-select">Pick raw sample</Link>. Rows below are grouped by <strong>calendar day (UTC)</strong>{" "}
        of <code>created_at</code> (newest days first).
      </p>
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <form onSubmit={onRefresh} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        <label style={lbl}>
          Filter by device
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            style={{ ...inp, minWidth: "240px" }}
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={btn} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </form>
      <div style={{ overflow: "auto" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Lifecycle</th>
              <th style={th}>Health</th>
              <th style={th}>Updated</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {groupedByDate.map((group) => (
              <Fragment key={group.dateKey}>
                <tr>
                  <td colSpan={5} style={dateGroupRow}>
                    <span style={{ fontWeight: 700, color: "var(--color-text)" }}>{group.heading}</span>
                    <span style={{ marginLeft: "0.5rem", color: "var(--color-text-muted)", fontWeight: 500 }}>
                      ({group.items.length} {group.items.length === 1 ? "object" : "objects"})
                    </span>
                  </td>
                </tr>
                {group.items.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={td}>
                        <strong>{r.name}</strong>
                        {r.error_message ? (
                          <div style={{ fontSize: "0.75rem", color: "#c62828", marginTop: "0.2rem" }}>{r.error_message}</div>
                        ) : null}
                      </td>
                      <td style={td}>
                        <code>{r.lifecycle_status}</code>
                      </td>
                      <td style={{ ...td, color: healthColor(r.health_status), fontWeight: 600 }}>
                        {r.health_status ?? "—"}
                        {r.health_code ? (
                          <div style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--color-text-muted)" }}>
                            {r.health_code}
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>
                        <div>{new Date(r.updated_at).toLocaleString()}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                          created {new Date(r.created_at).toLocaleString()}
                        </div>
                      </td>
                      <td style={td}>
                        {r.raw_data_object_id ? (
                          <Link
                            to={`/scrubber/create?rawId=${encodeURIComponent(
                              r.raw_data_object_id,
                            )}&deviceId=${encodeURIComponent(r.device_id)}&returnTo=${encodeURIComponent(
                              "/scrubber/data-objects",
                            )}`}
                            style={{ marginRight: "0.5rem" }}
                          >
                            Edit scrubber
                          </Link>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)", marginRight: "0.5rem" }}>No raw source</span>
                        )}
                        <button
                          type="button"
                          style={linkBtn}
                          onClick={() => setExpanded((x) => (x === r.id ? null : r.id))}
                        >
                          {expanded === r.id ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {expanded === r.id ? (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={5} style={{ ...td, background: "var(--color-bg)", verticalAlign: "top" }}>
                          <div style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                            <div>
                              <strong>data_object_id</strong>: <code>{r.id}</code>
                            </div>
                            <div>
                              <strong>device_id</strong>: <code>{r.device_id}</code>
                            </div>
                            {r.raw_data_object_id ? (
                              <div>
                                <strong>raw_data_object_id</strong>: <code>{r.raw_data_object_id}</code>
                              </div>
                            ) : null}
                            {r.scrubber_version ? (
                              <div>
                                <strong>scrubber_version</strong>: <code>{r.scrubber_version}</code>
                              </div>
                            ) : null}
                          </div>
                          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                            <div>
                              <div style={detailHdr}>Payload</div>
                              <pre style={pre}>{JSON.stringify(r.payload, null, 2)}</pre>
                            </div>
                            <div>
                              <div style={detailHdr}>KPI (kpi_json)</div>
                              <pre style={pre}>{JSON.stringify(r.kpi_json, null, 2)}</pre>
                            </div>
                          </div>
                          {r.health_message ? (
                            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                              <strong>Health message</strong>: {r.health_message}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !err && (
          <p style={{ color: "var(--color-text-muted)", marginTop: "0.5rem" }}>No data objects yet.</p>
        )}
      </div>
    </PageShell>
  );
}

const lbl: CSSProperties = {
  display: "grid",
  gap: "0.25rem",
  fontSize: "0.85rem",
  color: "var(--color-text-muted)",
};

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
  alignSelf: "flex-end",
};

const linkBtn: CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--color-accent)",
  cursor: "pointer",
  padding: 0,
  font: "inherit",
  textDecoration: "underline",
};

const tbl: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" };
const th: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid var(--color-border)",
  padding: "0.4rem",
};
const td: CSSProperties = { borderBottom: "1px solid var(--color-border)", padding: "0.4rem" };

const dateGroupRow: CSSProperties = {
  padding: "0.5rem 0.4rem",
  background: "color-mix(in oklab, var(--color-surface-elevated) 85%, var(--color-bg) 15%)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.82rem",
};

const detailHdr: CSSProperties = { fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.25rem" };
const pre: CSSProperties = {
  margin: 0,
  fontSize: "0.72rem",
  maxHeight: "240px",
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, monospace",
};
