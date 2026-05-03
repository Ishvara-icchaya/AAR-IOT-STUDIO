import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getMapIntelligenceExpanded,
  getMapIntelligenceHistoricalMarkers,
  getMapIntelligencePath,
  getMapObjectDetail,
} from "@/api/dashboard";
import { getTrendsWindow } from "@/api/trends";
import type { IntelOverlayState, IntelTraceRoute } from "@/components/dashboard/map/deckOverlaySiteMap";
import { stableHueFromString } from "@/lib/dashboard/mapLayerControls";
import { parseRichMapPointsFromApi } from "@/types/mapTransport";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function traceColorForRouteId(routeId: string): [number, number, number, number] {
  const h = stableHueFromString(routeId) / 360;
  const rgb = hslToRgb(h, 0.68, 0.52);
  return [...rgb, 228] as [number, number, number, number];
}

type Freshness = "active" | "stale" | "offline" | "unknown";

export type MapIntelligenceDeviceRow = {
  source_id: string;
  entityId: string;
  display_name?: string;
  mobility_type?: string;
  freshness_status?: Freshness;
  last_observed_at?: string | null;
  latest_kpis?: Record<string, unknown>;
  expected_frequency_sec?: number;
};

export type MapIntelligencePanelProps = {
  siteId: string;
  blockTitle: string;
  kpiKeys: string[];
  /** Dominant endpoint on the map, or null for site-wide roster. */
  endpointId: string | null;
  expanded: boolean;
  onIntelOverlay: (state: IntelOverlayState | null) => void;
};

function freshnessClass(s: string | undefined): string {
  const x = (s ?? "").toLowerCase();
  if (x === "active") return "dash-map-intel__pill--active";
  if (x === "stale") return "dash-map-intel__pill--stale";
  if (x === "offline") return "dash-map-intel__pill--offline";
  return "dash-map-intel__pill--unknown";
}

function formatKpiPreview(kpis: Record<string, unknown> | undefined): string {
  if (!kpis || typeof kpis !== "object") return "—";
  const entries = Object.entries(kpis).slice(0, 3);
  if (!entries.length) return "—";
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
}

export function MapIntelligencePanel({
  siteId,
  blockTitle,
  kpiKeys,
  endpointId,
  expanded,
  onIntelOverlay,
}: MapIntelligencePanelProps) {
  const searchId = useId();
  const [mode, setMode] = useState<"runtime" | "historical">("runtime");
  const [listKind, setListKind] = useState<"devices" | "endpoint">("devices");
  const [devicePage, setDevicePage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [selected, setSelected] = useState<MapIntelligenceDeviceRow | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathErr, setPathErr] = useState<string | null>(null);
  const [pathPolyline, setPathPolyline] = useState<[number, number][] | null>(null);
  const [replayFrame, setReplayFrame] = useState<number | null>(null);
  const [traceRoutes, setTraceRoutes] = useState<IntelTraceRoute[]>([]);
  const [pathExtras, setPathExtras] = useState<{
    gapPoints?: [number, number][];
    start?: [number, number];
    end?: [number, number];
  } | null>(null);
  const [samplesEpoch, setSamplesEpoch] = useState(0);
  const [showEndpointTrend, setShowEndpointTrend] = useState(false);
  const [showDeviceTrend, setShowDeviceTrend] = useState(false);
  const [trendSummary, setTrendSummary] = useState<string | null>(null);
  const histSamplesRef = useRef<[number, number][] | null>(null);
  const histRichRef = useRef<ReturnType<typeof parseRichMapPointsFromApi> | null>(null);

  const refreshSec = useMemo(() => {
    const n = Number(payload?.refresh_interval_sec);
    return Number.isFinite(n) && n >= 5 ? Math.min(300, Math.max(5, n)) : 15;
  }, [payload]);

  const fetchExpanded = useCallback(async () => {
    if (!expanded || !siteId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await getMapIntelligenceExpanded({
        siteId,
        endpointId: endpointId ?? undefined,
        mode,
        page: 1,
        limit: 200,
        kpiKeys,
      });
      setPayload(r ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Intelligence load failed");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [expanded, siteId, endpointId, mode, kpiKeys]);

  useEffect(() => {
    void fetchExpanded();
  }, [fetchExpanded]);

  useEffect(() => {
    if (!expanded) return;
    const t = window.setInterval(() => void fetchExpanded(), refreshSec * 1000);
    return () => window.clearInterval(t);
  }, [expanded, fetchExpanded, refreshSec]);

  useEffect(() => {
    if (mode === "runtime") {
      histSamplesRef.current = null;
      histRichRef.current = null;
      setTraceRoutes([]);
      setPathExtras(null);
      setSamplesEpoch((n) => n + 1);
      onIntelOverlay(null);
      setPathErr(null);
      setPathPolyline(null);
      setReplayFrame(null);
    }
  }, [mode, onIntelOverlay]);

  useEffect(() => {
    setTraceRoutes([]);
    setPathExtras(null);
    setPathPolyline(null);
    setReplayFrame(null);
    setPathErr(null);
  }, [siteId, endpointId]);

  useEffect(() => {
    if (mode !== "historical" || !expanded || !siteId) return;
    let cancelled = false;
    void (async () => {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - 24 * 3600 * 1000);
        const r = await getMapIntelligenceHistoricalMarkers({
          siteId,
          endpointId: endpointId ?? undefined,
          from: from.toISOString(),
          to: to.toISOString(),
          maxPoints: 600,
        });
        if (cancelled) return;
        const pts = Array.isArray(r?.sample_points) ? (r.sample_points as [number, number][]) : [];
        const rich = parseRichMapPointsFromApi(r?.rich_sample_points);
        histSamplesRef.current = pts.length ? pts : null;
        histRichRef.current = rich.length ? rich : null;
        if (!cancelled) setSamplesEpoch((n) => n + 1);
      } catch {
        histSamplesRef.current = null;
        histRichRef.current = null;
        if (!cancelled) setSamplesEpoch((n) => n + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, expanded, siteId, endpointId]);

  useEffect(() => {
    if (!expanded || mode !== "historical") return;
    const samples = histSamplesRef.current ?? undefined;
    const rich = histRichRef.current ?? undefined;
    const hasRoutes = traceRoutes.some((r) => r.path.length >= 2);
    const hasSamples = (samples?.length ?? 0) > 0 || (rich?.length ?? 0) > 0;
    if (!hasRoutes && !hasSamples) {
      onIntelOverlay(null);
      return;
    }
    const poly = pathPolyline;
    let movingLngLat: [number, number] | undefined;
    if (replayFrame != null && poly?.length) {
      const len = poly.length;
      const i = Math.min(Math.max(0, replayFrame), len - 1);
      movingLngLat = poly[i];
    }
    const overlay: IntelOverlayState = {
      ...(hasRoutes ? { traceRoutes } : {}),
      ...(poly && poly.length >= 2 ? { footprint: poly } : {}),
      ...(pathExtras?.gapPoints?.length ? { gapPoints: pathExtras.gapPoints } : {}),
      ...(pathExtras?.start ? { start: pathExtras.start } : {}),
      ...(pathExtras?.end ? { end: pathExtras.end } : {}),
      ...(movingLngLat ? { movingLngLat } : {}),
      ...(samples?.length ? { samplePoints: samples } : {}),
      ...(rich?.length ? { richSamplePoints: rich } : {}),
    };
    onIntelOverlay(overlay);
  }, [
    expanded,
    mode,
    traceRoutes,
    pathExtras,
    pathPolyline,
    replayFrame,
    samplesEpoch,
    onIntelOverlay,
  ]);

  useEffect(() => {
    if (replayFrame === null || pathPolyline === null) return;
    if (replayFrame >= pathPolyline.length) return;
    const t = window.setTimeout(() => setReplayFrame((f) => (f == null ? 0 : f + 1)), 55);
    return () => clearTimeout(t);
  }, [replayFrame, pathPolyline]);

  const devices = useMemo(() => {
    const raw = payload?.devices;
    if (!Array.isArray(raw)) return [] as MapIntelligenceDeviceRow[];
    return raw as MapIntelligenceDeviceRow[];
  }, [payload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => (d.display_name ?? "").toLowerCase().includes(q) || d.entityId.includes(q));
  }, [devices, search]);

  const PAGE_SIZE = 5;
  const sortedDevices = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const ta = a.last_observed_at ? new Date(a.last_observed_at).getTime() : 0;
      const tb = b.last_observed_at ? new Date(b.last_observed_at).getTime() : 0;
      return tb - ta;
    });
    return arr;
  }, [filtered]);

  const deviceTotalPages = Math.max(1, Math.ceil(sortedDevices.length / PAGE_SIZE));
  const devicePageClamped = Math.min(devicePage, deviceTotalPages);
  const pageSlice = useMemo(
    () => sortedDevices.slice((devicePageClamped - 1) * PAGE_SIZE, devicePageClamped * PAGE_SIZE),
    [sortedDevices, devicePageClamped],
  );

  useEffect(() => {
    setDevicePage(1);
  }, [search, listKind, devices.length, mode]);

  useEffect(() => {
    setDevicePage((p) => Math.min(p, deviceTotalPages));
  }, [deviceTotalPages]);

  const ep = payload?.endpoint as Record<string, unknown> | undefined;

  const loadDetail = useCallback(
    async (row: MapIntelligenceDeviceRow) => {
      setSelected(row);
      setDetailLoading(true);
      setDetail(null);
      try {
        const r = await getMapObjectDetail({
          siteId,
          sourceType: "latest_device_state",
          sourceId: row.source_id,
          kpiKeys: kpiKeys.length ? kpiKeys : undefined,
        });
        setDetail(r?.detail ?? null);
      } catch {
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [siteId, kpiKeys],
  );

  const loadPath = useCallback(async () => {
    if (!selected?.entityId || mode !== "historical") return;
    const entityId = selected.entityId;
    const routeLabel = selected.display_name?.trim() ? selected.display_name : undefined;
    setPathLoading(true);
    setPathErr(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 3600 * 1000);
      const exp = selected.expected_frequency_sec ?? 15;
      const path = await getMapIntelligencePath({
        siteId,
        entityId,
        from: from.toISOString(),
        to: to.toISOString(),
        expectedFrequencySec: exp,
      });
      if (!path) {
        setPathPolyline(null);
        setPathExtras(null);
        setReplayFrame(null);
        setTraceRoutes((prev) => prev.filter((r) => r.routeId !== entityId));
        setPathErr("Empty path response");
        return;
      }
      const poly = path.polyline as [number, number][] | undefined;
      if (poly && poly.length >= 2) {
        setPathPolyline(poly);
        setReplayFrame(null);
        const gapPoints = (path.gaps as { lng: number; lat: number }[] | undefined)?.map(
          (g) => [g.lng, g.lat] as [number, number],
        );
        setPathExtras({
          gapPoints: gapPoints?.length ? gapPoints : undefined,
          start: poly[0],
          end: poly[poly.length - 1],
        });
        setTraceRoutes((prev) => {
          const next = [
            ...prev.filter((r) => r.routeId !== entityId),
            {
              routeId: entityId,
              path: poly,
              color: traceColorForRouteId(entityId),
              label: routeLabel,
            },
          ];
          return next.slice(-8);
        });
      } else {
        setPathPolyline(null);
        setPathExtras(null);
        setReplayFrame(null);
        setTraceRoutes((prev) => prev.filter((r) => r.routeId !== entityId));
        setPathErr("No scrubbed path points in this window (ingest history may be empty).");
      }
    } catch (e) {
      setPathPolyline(null);
      setPathExtras(null);
      setReplayFrame(null);
      setTraceRoutes((prev) => prev.filter((r) => r.routeId !== entityId));
      setPathErr(e instanceof Error ? e.message : "Path load failed");
    } finally {
      setPathLoading(false);
    }
  }, [selected, mode, siteId]);

  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const trendContextKey = JSON.stringify(payload?.trend_context ?? null);

  useEffect(() => {
    if (!showEndpointTrend && !showDeviceTrend) {
      setTrendSummary(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const tc = payloadRef.current?.trend_context as Record<string, unknown> | undefined;
      if (!tc) {
        setTrendSummary(null);
        return;
      }
      const metrics = (kpiKeys.length ? kpiKeys : ["speed"]).slice(0, 4);
      try {
        const parts: string[] = [];
        if (showEndpointTrend && tc.endpoint && typeof tc.endpoint === "object") {
          const epObj = tc.endpoint as { entityId?: string; scope?: string };
          if (epObj.entityId && epObj.scope) {
            const tw = await getTrendsWindow({
              siteId,
              scope: epObj.scope,
              entityId: epObj.entityId,
              metrics,
              window: "1h",
            });
            if (!cancelled && tw) {
              const keys = Object.keys(tw.series ?? {});
              parts.push(`Endpoint (${epObj.scope}): ${keys.length} series`);
            }
          }
        }
        if (!cancelled && showDeviceTrend && selected?.entityId) {
          const tw = await getTrendsWindow({
            siteId,
            scope: "resolved_device",
            entityId: selected.entityId,
            metrics,
            window: "1h",
          });
          if (tw) {
            const keys = Object.keys(tw.series ?? {});
            parts.push(`Device: ${keys.length} series`);
          }
        }
        if (!cancelled) setTrendSummary(parts.join(" · ") || null);
      } catch (e) {
        if (!cancelled) setTrendSummary(e instanceof Error ? e.message : "Trend fetch failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showEndpointTrend, showDeviceTrend, siteId, kpiKeys, selected?.entityId, trendContextKey]);

  return (
    <aside className="dash-map-intel" aria-label="Map intelligence">
      <div className="dash-map-intel__head">
        <table className="dash-map-intel__head-table">
          <tbody>
            <tr>
              <th scope="row" className="dash-map-intel__head-th">
                Panel
              </th>
              <td className="dash-map-intel__head-td dash-map-intel__head-td--text">
                <h4 className="dash-map-intel__title">Intelligence</h4>
                <p className="dash-map-intel__subtitle">{blockTitle}</p>
              </td>
              <th scope="row" className="dash-map-intel__head-th">
                Mode
              </th>
              <td className="dash-map-intel__head-td dash-map-intel__head-td--modes">
                <div className="dash-map-intel__mode-row" role="group" aria-label="Map mode">
                  <button
                    type="button"
                    className={`dash-map-intel__mode-btn ${mode === "runtime" ? "dash-map-intel__mode-btn--on" : ""}`}
                    onClick={() => setMode("runtime")}
                  >
                    Runtime
                  </button>
                  <button
                    type="button"
                    className={`dash-map-intel__mode-btn ${mode === "historical" ? "dash-map-intel__mode-btn--on" : ""}`}
                    onClick={() => setMode("historical")}
                  >
                    Historical
                  </button>
                </div>
                <p className="dash-map-intel__hint dash-map-intel__hint--under-mode">
                  Select a row in the devices table below for detail and historical path.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="dash-map-intel__section dash-map-intel__section--trends" aria-labelledby="dash-map-intel-trends">
        <h5 id="dash-map-intel-trends" className="dash-map-intel__section-title">
          Trends (diagnostics)
        </h5>
        <div className="dash-map-intel__trend-row">
          <label className="dash-map-intel__chk">
            <input type="checkbox" checked={showEndpointTrend} onChange={(e) => setShowEndpointTrend(e.target.checked)} />
            Endpoint (1h)
          </label>
          <label className="dash-map-intel__chk">
            <input
              type="checkbox"
              checked={showDeviceTrend}
              onChange={(e) => setShowDeviceTrend(e.target.checked)}
              disabled={!selected?.entityId}
            />
            Device (1h)
          </label>
        </div>
        {trendSummary ? <p className="dash-map-intel__muted dash-map-intel__muted--tight">{trendSummary}</p> : null}
      </section>

      <section className="dash-map-intel__section" aria-labelledby="dash-map-intel-endpoint">
        <h5 id="dash-map-intel-endpoint" className="dash-map-intel__section-title">
          Endpoint summary
        </h5>
        {loading && !payload ? (
          <p className="dash-map-intel__muted">Loading…</p>
        ) : err ? (
          <p className="dash-map-intel__err">{err}</p>
        ) : (
          <dl className="dash-map-intel__dl">
            <div>
              <dt>Site</dt>
              <dd>{siteId}</dd>
            </div>
            <div>
              <dt>Endpoint</dt>
              <dd>{ep?.name ? String(ep.name) : "—"}</dd>
            </div>
            <div>
              <dt>Devices</dt>
              <dd>{typeof ep?.device_count === "number" ? ep.device_count : devices.length}</dd>
            </div>
            <div>
              <dt>Active / stale / offline / unknown</dt>
              <dd>
                {typeof ep?.active_count === "number" ? ep.active_count : "—"} /{" "}
                {typeof ep?.stale_count === "number" ? ep.stale_count : "—"} /{" "}
                {typeof ep?.offline_count === "number" ? ep.offline_count : "—"} /{" "}
                {typeof ep?.unknown_count === "number" ? ep.unknown_count : "—"}
              </dd>
            </div>
            <div>
              <dt>Refresh</dt>
              <dd>
                every {refreshSec}s
                {typeof payload?.observable_window_sec === "number"
                  ? ` · stale window ≥ ${String(payload.observable_window_sec)}s`
                  : null}
              </dd>
            </div>
            {payload?.aggregate_kpis && typeof payload.aggregate_kpis === "object" ? (
              <div>
                <dt>Aggregate KPIs (mean)</dt>
                <dd className="dash-map-intel__kpi-inline">
                  {formatKpiPreview(payload.aggregate_kpis as Record<string, unknown>)}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </section>

      <section className="dash-map-intel__section" aria-labelledby="dash-map-intel-devices">
        <h5 id="dash-map-intel-devices" className="dash-map-intel__section-title">
          Roster
        </h5>
        <div className="dash-map-intel__list-kind" role="group" aria-label="Roster source: devices or endpoint summary">
          <button
            type="button"
            className={`dash-map-intel__tab ${listKind === "devices" ? "dash-map-intel__tab--on" : ""}`}
            onClick={() => setListKind("devices")}
          >
            Devices
          </button>
          <button
            type="button"
            className={`dash-map-intel__tab ${listKind === "endpoint" ? "dash-map-intel__tab--on" : ""}`}
            onClick={() => setListKind("endpoint")}
          >
            Endpoint
          </button>
        </div>
        {listKind === "devices" ? (
          <>
            <label className="dash-map-intel__search-label" htmlFor={searchId}>
              Filter devices
            </label>
            <input
              id={searchId}
              type="search"
              className="dash-map-intel__search"
              placeholder="Name or id…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="dash-map-intel__table-wrap">
              <table className="dash-map-intel__data-table">
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">State</th>
                    <th scope="col">Mobility</th>
                    <th scope="col">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="dash-map-intel__td-empty">
                        {loading && !payload
                          ? "Loading…"
                          : err
                            ? String(err)
                            : devices.length === 0
                              ? "No devices in this scope. Check map binding or refresh."
                              : "No matches. Clear the filter."}
                      </td>
                    </tr>
                  ) : (
                    pageSlice.map((d) => (
                      <tr
                        key={d.source_id}
                        className={selected?.source_id === d.source_id ? "dash-map-intel__tr--sel" : undefined}
                      >
                        <td className="dash-map-intel__td-wrap">
                          <button
                            type="button"
                            className="dash-map-intel__row-btn"
                            onClick={() => void loadDetail(d)}
                          >
                            {d.display_name ?? d.entityId}
                          </button>
                        </td>
                        <td>
                          <span className={`dash-map-intel__pill ${freshnessClass(d.freshness_status)}`}>
                            {d.freshness_status ?? "—"}
                          </span>
                        </td>
                        <td className="dash-map-intel__td-wrap">{d.mobility_type ?? "—"}</td>
                        <td className="dash-map-intel__td-nowrap">
                          {d.last_observed_at ? new Date(d.last_observed_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {sortedDevices.length > PAGE_SIZE ? (
              <div className="dash-map-intel__pager">
                <button
                  type="button"
                  className="dash-map-intel__pager-btn"
                  disabled={devicePageClamped <= 1}
                  onClick={() => setDevicePage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span className="dash-map-intel__pager-meta">
                  Page {devicePageClamped} / {deviceTotalPages} · {sortedDevices.length} devices (newest first)
                </span>
                <button
                  type="button"
                  className="dash-map-intel__pager-btn"
                  disabled={devicePageClamped >= deviceTotalPages}
                  onClick={() => setDevicePage((p) => Math.min(deviceTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="dash-map-intel__table-wrap">
            <table className="dash-map-intel__data-table">
              <thead>
                <tr>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Devices</th>
                  <th scope="col">Active / stale / off / ?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="dash-map-intel__td-wrap">{ep?.name ? String(ep.name) : "—"}</td>
                  <td>{typeof ep?.device_count === "number" ? ep.device_count : devices.length}</td>
                  <td className="dash-map-intel__td-wrap">
                    {typeof ep?.active_count === "number" ? ep.active_count : "—"} /{" "}
                    {typeof ep?.stale_count === "number" ? ep.stale_count : "—"} /{" "}
                    {typeof ep?.offline_count === "number" ? ep.offline_count : "—"} /{" "}
                    {typeof ep?.unknown_count === "number" ? ep.unknown_count : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="dash-map-intel__hint">Use the Devices tab to pick a row for detail and path tools.</p>
          </div>
        )}
        {mode === "historical" && selected ? (
          <div className="dash-map-intel__path-actions">
            <button type="button" className="dash-map-intel__btn" disabled={pathLoading} onClick={() => void loadPath()}>
              {pathLoading ? "Loading path…" : "Load 24h footprint"}
            </button>
            <button
              type="button"
              className="dash-map-intel__btn"
              disabled={!pathPolyline || pathPolyline.length < 2 || pathLoading}
              title="Replay: moving head along the selected route; all loaded traces stay full length"
              onClick={() => setReplayFrame(0)}
            >
              Replay path
            </button>
            {pathErr ? <p className="dash-map-intel__err">{pathErr}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="dash-map-intel__section" aria-labelledby="dash-map-intel-detail">
        <h5 id="dash-map-intel-detail" className="dash-map-intel__section-title">
          Selected device
        </h5>
        {!selected ? (
          <p className="dash-map-intel__muted">No row selected — use the Devices table above.</p>
        ) : detailLoading ? (
          <p className="dash-map-intel__muted">Loading detail…</p>
        ) : (
          <>
            <p className="dash-map-intel__muted">
              <strong>{selected.display_name ?? selected.entityId}</strong> · mobility{" "}
              <span className="dash-map-intel__mono">{selected.mobility_type ?? "unknown"}</span>
            </p>
            {detail ? (
              <pre className="dash-map-intel__pre">{JSON.stringify(detail, null, 2).slice(0, 2400)}</pre>
            ) : (
              <p className="dash-map-intel__muted">No detail payload.</p>
            )}
          </>
        )}
      </section>
    </aside>
  );
}
