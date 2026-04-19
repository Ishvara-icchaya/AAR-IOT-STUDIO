import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/api/client";
import type { DataObjectDetailListDTO } from "@/api/scrubber";
import { listDataObjectDetails } from "@/api/scrubber";
import { listDevices, type DeviceRead } from "@/api/devices";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";

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
  latest_detail_id?: string | null;
  latest_seen_at?: string | null;
};

type ListResp = { items: DataObjectRow[] };

function healthColor(status: string | null): string {
  const s = (status || "").toLowerCase();
  if (s === "green") return "#2d8a4e";
  if (s === "yellow") return "#b8860b";
  if (s === "red") return "#c62828";
  return "var(--color-text-muted)";
}

function deviceHasArchivedPayload(d: DeviceRead): boolean {
  return Boolean(d.endpoint?.first_payload_at);
}

/** Paginated sample of observed history when a row is expanded. */
function DataObjectObservedHistory({ dataObjectId }: { dataObjectId: string }) {
  const [data, setData] = useState<DataObjectDetailListDTO | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistErr(null);
    void (async () => {
      try {
        const d = await listDataObjectDetails(dataObjectId, { page: 1, page_size: 25 });
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setHistErr(e instanceof Error ? e.message : "Failed to load history");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataObjectId]);

  if (histErr) {
    return <p style={{ color: "#c62828", fontSize: "0.8rem" }}>{histErr}</p>;
  }
  if (!data) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>Loading observed history…</p>;
  }
  if (data.total === 0) {
    return <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>No detail rows yet.</p>;
  }
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.35rem" }}>
        Observed history ({data.total} sample{data.total === 1 ? "" : "s"}) — page {data.page}
      </div>
      <table style={{ width: "100%", fontSize: "0.75rem", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>Observed</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>Health</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>detail id</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.id}>
              <td style={{ borderBottom: "1px solid var(--color-border)", padding: "0.25rem 0" }}>
                {new Date(it.observed_at).toLocaleString()}
              </td>
              <td style={{ borderBottom: "1px solid var(--color-border)", padding: "0.25rem 0" }}>
                {it.health_status ?? "—"}
              </td>
              <td style={{ borderBottom: "1px solid var(--color-border)", padding: "0.25rem 0" }}>
                <code style={{ fontSize: "0.68rem" }}>{it.id}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Data objects listed by registered device; scrubber actions require archived payload on the device endpoint. */
export function DataObjectsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [devices, setDevices] = useState<DeviceRead[]>([]);
  const [deviceFilter, setDeviceFilter] = useState("");
  const [rows, setRows] = useState<DataObjectRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(true);

  useEffect(() => {
    setDeviceFilter(searchParams.get("device")?.trim() ?? "");
  }, [searchParams]);

  const setDeviceFilterAndUrl = useCallback(
    (id: string) => {
      setDeviceFilter(id);
      const next = new URLSearchParams(searchParams);
      if (id) next.set("device", id);
      else next.delete("device");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    let cancelled = false;
    setDevicesLoading(true);
    void (async () => {
      try {
        const list = await listDevices();
        if (!cancelled) setDevices(list);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load devices");
      } finally {
        if (!cancelled) setDevicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (deviceFilter) qs.set("device_id", deviceFilter);
      const data = await apiFetch<ListResp>(`/scrubber/data-objects?${qs.toString()}`, {
        cache: "no-store",
      });
      setRows(data?.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load data objects");
    } finally {
      setLoading(false);
    }
  }, [deviceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const devicesInScope = useMemo(() => {
    const sorted = [...devices].sort((a, b) => a.name.localeCompare(b.name));
    if (!deviceFilter) return sorted;
    return sorted.filter((d) => d.id === deviceFilter);
  }, [devices, deviceFilter]);

  const objectsByDevice = useMemo(() => {
    const m = new Map<string, DataObjectRow[]>();
    for (const r of rows) {
      const list = m.get(r.device_id) ?? [];
      list.push(r);
      m.set(r.device_id, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return m;
  }, [rows]);

  return (
    <PageShell title="View Data Objects">
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem", alignItems: "flex-end" }}>
        <label style={lbl}>
          Device
          <select
            value={deviceFilter}
            onChange={(e) => setDeviceFilterAndUrl(e.target.value)}
            style={{ ...inp, minWidth: "240px" }}
            disabled={devicesLoading}
          >
            <option value="">All registered devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={btn} disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div className="table-scroll-sticky" style={{ overflow: "auto" }}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Device</th>
              <th style={th}>Archived payload</th>
              <th style={th}>Data object</th>
              <th style={th}>Lifecycle</th>
              <th style={th}>Health</th>
              <th style={th}>Updated</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devicesInScope.map((d) => {
              const objs = objectsByDevice.get(d.id) ?? [];
              const scrubberEnabled = deviceHasArchivedPayload(d);
              if (objs.length === 0) {
                return (
                  <tr key={d.id}>
                    <td style={td}>
                      <strong>{d.name}</strong>
                    </td>
                    <td style={td}>{scrubberEnabled ? "Yes" : "No"}</td>
                    <td style={{ ...td, color: "var(--color-text-muted)" }} colSpan={4}>
                      No data objects for this device yet.
                    </td>
                    <td style={td}>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "0.82rem" }}>
                        {scrubberEnabled ? "—" : "Scrubber unlocks after the first payload is archived."}
                      </span>
                    </td>
                  </tr>
                );
              }
              return (
                <Fragment key={d.id}>
                  {objs.map((r, idx) => (
                    <Fragment key={r.id}>
                      <tr>
                        <td style={td}>{idx === 0 ? <strong>{d.name}</strong> : null}</td>
                        <td style={td}>{idx === 0 ? (scrubberEnabled ? "Yes" : "No") : null}</td>
                        <td style={td}>
                          <strong>{r.name}</strong>
                          {r.error_message ? (
                            <div style={{ fontSize: "0.75rem", color: "#c62828", marginTop: "0.2rem" }}>
                              {r.error_message}
                            </div>
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
                          {r.latest_seen_at ? (
                            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                              last sample {new Date(r.latest_seen_at).toLocaleString()}
                            </div>
                          ) : null}
                        </td>
                        <td style={td}>
                          {scrubberEnabled && r.raw_data_object_id ? (
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
                            <span style={{ color: "var(--color-text-muted)", marginRight: "0.5rem" }}>
                              {scrubberEnabled ? "No raw source" : "Scrubber locked"}
                            </span>
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
                          <td colSpan={7} style={{ ...td, background: "var(--color-bg)", verticalAlign: "top" }}>
                            <div style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                              <div>
                                <strong>device</strong>: {d.name} (<code>{r.device_id}</code>)
                              </div>
                              <div>
                                <strong>data_object_id</strong>: <code>{r.id}</code>
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
                            <div
                              style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
                            >
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
                            <DataObjectObservedHistory dataObjectId={r.id} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!devicesLoading && devicesInScope.length === 0 && !err && (
          <p style={{ color: "var(--color-text-muted)", marginTop: "0.5rem" }}>No devices in scope.</p>
        )}
        {!loading && devicesInScope.length > 0 && rows.length === 0 && !deviceFilter && !err && (
          <p style={{ color: "var(--color-text-muted)", marginTop: "0.5rem" }}>
            No data objects yet for the devices shown.
          </p>
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
