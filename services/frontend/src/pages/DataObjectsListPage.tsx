import type { CSSProperties, FormEvent } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { getScrubberDataObject } from "@/api/scrubber";
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

/** One row per (device_id + name), keeping the most recently updated. */
function aggregateLatestPerNameDevice(rows: DataObjectRow[]): DataObjectRow[] {
  const map = new Map<string, DataObjectRow>();
  for (const r of rows) {
    const k = `${r.device_id}\0${r.name}`;
    const prev = map.get(k);
    if (!prev || new Date(r.updated_at).getTime() > new Date(prev.updated_at).getTime()) {
      map.set(k, r);
    }
  }
  return [...map.values()].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function pickLatestRow(rows: DataObjectRow[]): DataObjectRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, r) =>
    new Date(r.updated_at).getTime() > new Date(best.updated_at).getTime() ? r : best,
  rows[0]);
}

/** Compiled `data_object` rows produced by the scrubber worker (`GET /scrubber/data-objects`). */
export function DataObjectsListPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [rows, setRows] = useState<DataObjectRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** `all` = every row (grouped by day, as before). `aggregated` = latest row per device + object name. */
  const [tableView, setTableView] = useState<"all" | "aggregated">("aggregated");
  const [lastProcessedOpen, setLastProcessedOpen] = useState(false);
  const [lastDataDetail, setLastDataDetail] = useState<Awaited<ReturnType<typeof getScrubberDataObject>> | null>(null);
  const [lastDataLoading, setLastDataLoading] = useState(false);

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

  const displayRows = useMemo(
    () => (tableView === "aggregated" ? aggregateLatestPerNameDevice(rows) : rows),
    [rows, tableView],
  );
  const groupedByDate = useMemo(() => groupRowsByCreatedDate(displayRows), [displayRows]);
  const latestRow = useMemo(() => pickLatestRow(rows), [rows]);

  async function onRefresh(e: FormEvent) {
    e.preventDefault();
    await load();
  }

  async function toggleLastProcessed() {
    if (!latestRow) return;
    if (lastProcessedOpen) {
      setLastProcessedOpen(false);
      setLastDataDetail(null);
      return;
    }
    setLastProcessedOpen(true);
    setLastDataDetail(null);
    setLastDataLoading(true);
    try {
      const d = await getScrubberDataObject(latestRow.id);
      setLastDataDetail(d);
    } catch {
      setLastDataDetail(null);
    } finally {
      setLastDataLoading(false);
    }
  }

  return (
    <PageShell title="View Data Objects">
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
            <tr>
              <td colSpan={5} style={tableToolbarRow}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
                  <label style={{ ...lbl, margin: 0 }}>
                    Table contents
                    <select
                      value={tableView}
                      onChange={(e) => setTableView(e.target.value as "all" | "aggregated")}
                      style={{ ...inp, minWidth: "16rem" }}
                    >
                      <option value="aggregated">Latest per data object (device + name)</option>
                      <option value="all">All data objects (full history)</option>
                    </select>
                  </label>
                  <button type="button" style={btn} disabled={!latestRow || loading} onClick={() => void toggleLastProcessed()}>
                    {lastProcessedOpen ? "Hide last processed" : "View last processed data"}
                  </button>
                  <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", maxWidth: "28rem", lineHeight: 1.4 }}>
                    Last processed = row with newest <code>updated_at</code> among the current device filter. Opens below.
                  </span>
                </div>
              </td>
            </tr>
            {lastProcessedOpen && latestRow ? (
              <tr>
                <td colSpan={5} style={lastProcessedPanel}>
                  <div style={{ marginBottom: "0.65rem" }}>
                    <strong style={{ fontSize: "0.95rem" }}>Last processed data</strong>
                    <div style={{ fontSize: "0.82rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
                      <strong>{latestRow.name}</strong> · <code style={{ fontSize: "0.78rem" }}>{latestRow.id}</code>
                      <br />
                      Updated {new Date(latestRow.updated_at).toLocaleString()}
                    </div>
                  </div>
                  {lastDataLoading ? (
                    <p style={{ color: "var(--color-text-muted)", margin: 0 }}>Loading latest from API…</p>
                  ) : lastDataDetail ? (
                    <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                      <div>
                        <div style={detailHdr}>Payload</div>
                        <pre style={{ ...pre, maxHeight: "min(50vh, 360px)" }}>{JSON.stringify(lastDataDetail.payload, null, 2)}</pre>
                      </div>
                      <div>
                        <div style={detailHdr}>KPI (kpi_json)</div>
                        <pre style={{ ...pre, maxHeight: "min(40vh, 280px)" }}>{JSON.stringify(lastDataDetail.kpi_json, null, 2)}</pre>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                      <div>
                        <div style={detailHdr}>Payload (list row)</div>
                        <pre style={{ ...pre, maxHeight: "min(50vh, 360px)" }}>{JSON.stringify(latestRow.payload, null, 2)}</pre>
                      </div>
                      <div>
                        <div style={detailHdr}>KPI (list row)</div>
                        <pre style={{ ...pre, maxHeight: "min(40vh, 280px)" }}>{JSON.stringify(latestRow.kpi_json, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                  {(lastDataDetail?.health_status ?? latestRow.health_status) ? (
                    <p style={{ fontSize: "0.85rem", marginTop: "0.75rem", marginBottom: 0 }}>
                      <strong>Health</strong>:{" "}
                      <span style={{ color: healthColor(lastDataDetail?.health_status ?? latestRow.health_status) }}>
                        {lastDataDetail?.health_status ?? latestRow.health_status}
                      </span>
                      {lastDataDetail?.health_message || latestRow.health_message ? (
                        <span> — {lastDataDetail?.health_message ?? latestRow.health_message}</span>
                      ) : null}
                    </p>
                  ) : null}
                </td>
              </tr>
            ) : null}
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
  color: "var(--btn-on-accent)",
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

const tableToolbarRow: CSSProperties = {
  padding: "0.65rem 0.5rem",
  background: "color-mix(in oklab, var(--color-surface-elevated) 78%, var(--color-bg) 22%)",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};

const lastProcessedPanel: CSSProperties = {
  padding: "0.85rem 0.55rem",
  background: "color-mix(in oklab, var(--color-bg) 88%, var(--color-surface) 12%)",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
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

