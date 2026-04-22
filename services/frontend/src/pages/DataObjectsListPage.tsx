import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BrushCleaning, ChevronDown, ChevronUp } from "lucide-react";
import { apiFetch } from "@/api/client";
import type { DataObjectDetailDTO, DataObjectDetailListDTO } from "@/api/scrubber";
import { listDataObjectDetails } from "@/api/scrubber";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { listDevices, type DeviceRead } from "@/api/devices";
import { PageStatus } from "@/components/PageStatus";
import { PageShell } from "@/layouts/PageShell";
import "./device-register-page.css";

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
    <DataObjectObservedHistoryGrid data={data} />
  );
}

function DataObjectObservedHistoryGrid({ data }: { data: DataObjectDetailListDTO }) {
  const columns = useMemo<PlainOperationalColumn<DataObjectDetailDTO>[]>(
    () => [
      {
        id: "observed_at",
        header: "Observed",
        cell: (r) => new Date(r.observed_at).toLocaleString(),
      },
      {
        id: "health_status",
        header: "Health",
        cell: (r) => String(r.health_status ?? "—"),
      },
      {
        id: "id",
        header: "detail id",
        cell: (r) => <code style={{ fontSize: "0.68rem" }}>{r.id}</code>,
      },
    ],
    [],
  );
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.35rem" }}>
        Observed history ({data.total} sample{data.total === 1 ? "" : "s"}) — page {data.page}
      </div>
      <PlainOperationalTable<DataObjectDetailDTO>
        rows={data.items}
        columns={columns}
        getRowId={(r) => r.id}
        maxHeight="min(40vh, 320px)"
        bordered
      />
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
    <PageShell variant="list" className="data-objects-list-page device-manage-page">
      <div className="dm-root">
        <header className="dm-page-hero">
          <div className="dm-page-hero__top">
            <div className="dm-page-hero__titles">
              <h1 className="dm-page-hero__title">Data objects</h1>
              <p className="dm-page-hero__subtitle">Scrubber outputs by registered device.</p>
            </div>
          </div>
        </header>

        {err ? <PageStatus variant="error">{err}</PageStatus> : null}

        <section className="dm-filter-panel" aria-label="Device filter">
          <div className="dm-controls-form__row">
            <label className="dm-filter-field dm-filter-field--grow">
              <span className="dm-filter-field__label">Device</span>
              <select value={deviceFilter} onChange={(e) => setDeviceFilterAndUrl(e.target.value)} disabled={devicesLoading}>
                <option value="">All registered devices</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="dm-btn dm-btn--primary" disabled={loading} onClick={() => void load()}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </section>

        <div className="dm-table-wrap">
          <div className="dm-device-table-shell">
            <div className="dm-table-scroll">
              <table className="dm-data-table">
                <thead>
                  <tr>
                    <th className="dm-data-table__th" scope="col">
                      Device
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Archived payload
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Data object
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Lifecycle
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Health
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Updated
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--actions" scope="col">
                      Actions
                    </th>
                  </tr>
                </thead>
          <tbody>
            {devicesInScope.map((d) => {
              const objs = objectsByDevice.get(d.id) ?? [];
              const scrubberEnabled = deviceHasArchivedPayload(d);
              if (objs.length === 0) {
                return (
                  <tr key={d.id}>
                    <td className="dm-data-table__td">
                      <strong>{d.name}</strong>
                    </td>
                    <td className="dm-data-table__td">{scrubberEnabled ? "Yes" : "No"}</td>
                    <td className="dm-data-table__td" style={{ color: "var(--color-text-muted)" }} colSpan={4}>
                      No data objects for this device yet.
                    </td>
                    <td className="dm-data-table__td">
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
                        <td className="dm-data-table__td">{idx === 0 ? <strong>{d.name}</strong> : null}</td>
                        <td className="dm-data-table__td">{idx === 0 ? (scrubberEnabled ? "Yes" : "No") : null}</td>
                        <td className="dm-data-table__td">
                          <strong>{r.name}</strong>
                          {r.error_message ? (
                            <div style={{ fontSize: "0.75rem", color: "#c62828", marginTop: "0.2rem" }}>
                              {r.error_message}
                            </div>
                          ) : null}
                        </td>
                        <td className="dm-data-table__td">
                          <code>{r.lifecycle_status}</code>
                        </td>
                        <td className="dm-data-table__td" style={{ color: healthColor(r.health_status), fontWeight: 600 }}>
                          {r.health_status ?? "—"}
                          {r.health_code ? (
                            <div style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--color-text-muted)" }}>
                              {r.health_code}
                            </div>
                          ) : null}
                        </td>
                        <td className="dm-data-table__td">
                          <div>{new Date(r.updated_at).toLocaleString()}</div>
                          {r.latest_seen_at ? (
                            <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                              last sample {new Date(r.latest_seen_at).toLocaleString()}
                            </div>
                          ) : null}
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--actions">
                          <div className="dm-act-grid">
                            {scrubberEnabled && r.raw_data_object_id ? (
                              <Link
                                className="dm-act-grid__btn"
                                to={`/scrubber/create?rawId=${encodeURIComponent(
                                  r.raw_data_object_id,
                                )}&deviceId=${encodeURIComponent(r.device_id)}&returnTo=${encodeURIComponent(
                                  "/scrubber/data-objects",
                                )}`}
                                title="Open Scrubber Studio"
                                aria-label={`Open scrubber for ${r.name}`}
                              >
                                <BrushCleaning size={16} strokeWidth={2} aria-hidden />
                              </Link>
                            ) : (
                              <button
                                type="button"
                                className="dm-act-grid__btn dm-act-grid__btn--disabled"
                                disabled
                                title={
                                  scrubberEnabled ? "No raw source linked for this row" : "Scrubber is locked for this tenant"
                                }
                                aria-label="Scrubber unavailable"
                              >
                                <BrushCleaning size={16} strokeWidth={2} aria-hidden />
                              </button>
                            )}
                            <button
                              type="button"
                              className="dm-act-grid__btn dm-act-grid__btn--plain"
                              title={expanded === r.id ? "Hide row details" : "Show row details"}
                              aria-label={expanded === r.id ? "Hide details" : "Show details"}
                              onClick={() => setExpanded((x) => (x === r.id ? null : r.id))}
                            >
                              {expanded === r.id ? (
                                <ChevronUp size={16} strokeWidth={2} aria-hidden />
                              ) : (
                                <ChevronDown size={16} strokeWidth={2} aria-hidden />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded === r.id ? (
                        <tr key={`${r.id}-detail`}>
                          <td
                            colSpan={7}
                            className="dm-data-table__td"
                            style={{ background: "var(--dm-surface-2, var(--color-bg))", verticalAlign: "top" }}
                          >
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
                <p className="dm-inline-summary" style={{ marginTop: "0.5rem" }}>
                  No devices in scope.
                </p>
              )}
              {!loading && devicesInScope.length > 0 && rows.length === 0 && !deviceFilter && !err && (
                <p className="dm-inline-summary" style={{ marginTop: "0.5rem" }}>
                  No data objects yet for the devices shown.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

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
