import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getMapIntelligenceExpanded,
  getMapIntelligenceHistoricalMarkers,
  getMapIntelligencePath,
  getMapObjectDetail,
} from "@/api/dashboard";
import { getTrendsWindow } from "@/api/trends";
import type { IntelOverlayState } from "@/components/dashboard/map/deckOverlaySiteMap";
import { parseRichMapPointsFromApi } from "@/types/mapTransport";

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
      onIntelOverlay(null);
      setPathErr(null);
      setPathPolyline(null);
      setReplayFrame(null);
    }
  }, [mode, onIntelOverlay]);

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
        const overlay: IntelOverlayState | null =
          histSamplesRef.current || histRichRef.current
            ? {
                samplePoints: histSamplesRef.current ?? undefined,
                richSamplePoints: histRichRef.current ?? undefined,
              }
            : null;
        onIntelOverlay(overlay);
      } catch {
        histSamplesRef.current = null;
        histRichRef.current = null;
        if (!cancelled) onIntelOverlay(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, expanded, siteId, endpointId, onIntelOverlay]);

  useEffect(() => {
    if (replayFrame === null || !pathPolyline?.length) return;
    const poly = pathPolyline;
    const len = poly.length;
    const samples = histSamplesRef.current ?? undefined;
    const rich = histRichRef.current ?? undefined;
    if (replayFrame >= len) {
      onIntelOverlay({
        footprint: poly,
        start: poly[0],
        end: poly[len - 1],
        movingLngLat: poly[len - 1],
        samplePoints: samples,
        richSamplePoints: rich,
      });
      return;
    }
    onIntelOverlay({
      footprint: poly.slice(0, replayFrame + 1),
      start: poly[0],
      end: poly[len - 1],
      movingLngLat: poly[replayFrame],
      samplePoints: samples,
      richSamplePoints: rich,
    });
  }, [replayFrame, pathPolyline, onIntelOverlay]);

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
    setPathLoading(true);
    setPathErr(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 3600 * 1000);
      const exp = selected.expected_frequency_sec ?? 15;
      const path = await getMapIntelligencePath({
        siteId,
        entityId: selected.entityId,
        from: from.toISOString(),
        to: to.toISOString(),
        expectedFrequencySec: exp,
      });
      if (!path) {
        setPathPolyline(null);
        setPathErr("Empty path response");
        onIntelOverlay(null);
        return;
      }
      const poly = path.polyline as [number, number][] | undefined;
      if (poly && poly.length >= 2) {
        setPathPolyline(poly);
        setReplayFrame(null);
        const gapPoints = (path.gaps as { lng: number; lat: number }[] | undefined)?.map(
          (g) => [g.lng, g.lat] as [number, number],
        );
        onIntelOverlay({
          footprint: poly,
          gapPoints: gapPoints?.length ? gapPoints : undefined,
          start: poly[0],
          end: poly[poly.length - 1],
          samplePoints: histSamplesRef.current ?? undefined,
          richSamplePoints: histRichRef.current ?? undefined,
        });
      } else {
        setPathPolyline(null);
        onIntelOverlay(null);
        setPathErr("No scrubbed path points in this window (ingest history may be empty).");
      }
    } catch (e) {
      setPathPolyline(null);
      setPathErr(e instanceof Error ? e.message : "Path load failed");
      onIntelOverlay(null);
    } finally {
      setPathLoading(false);
    }
  }, [selected, mode, siteId, onIntelOverlay]);

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
        <h4 className="dash-map-intel__title">Intelligence</h4>
        <p className="dash-map-intel__subtitle">{blockTitle}</p>
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
      </div>

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
          Devices
        </h5>
        <label className="dash-map-intel__search-label" htmlFor={searchId}>
          Search
        </label>
        <input
          id={searchId}
          type="search"
          className="dash-map-intel__search"
          placeholder="Filter by name or id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className="dash-map-intel__device-list" role="listbox" aria-label="Devices">
          {filtered.map((d) => (
            <li key={d.source_id}>
              <button
                type="button"
                className={`dash-map-intel__device-row ${selected?.source_id === d.source_id ? "dash-map-intel__device-row--sel" : ""}`}
                onClick={() => void loadDetail(d)}
              >
                <span className="dash-map-intel__device-name">{d.display_name ?? d.entityId}</span>
                <span className={`dash-map-intel__pill ${freshnessClass(d.freshness_status)}`}>
                  {d.freshness_status ?? "—"}
                </span>
                <span className="dash-map-intel__device-meta">
                  {d.mobility_type ?? "?"} · {d.last_observed_at ? new Date(d.last_observed_at).toLocaleString() : "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {mode === "historical" && selected ? (
          <div className="dash-map-intel__path-actions">
            <button type="button" className="dash-map-intel__btn" disabled={pathLoading} onClick={() => void loadPath()}>
              {pathLoading ? "Loading path…" : "Load 24h footprint"}
            </button>
            <button
              type="button"
              className="dash-map-intel__btn"
              disabled={!pathPolyline || pathPolyline.length < 2 || pathLoading}
              title="Replay route: growing line with moving head, then full path"
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
          <p className="dash-map-intel__muted">Choose a device from the list.</p>
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

      <section className="dash-map-intel__section" aria-labelledby="dash-map-intel-trends">
        <h5 id="dash-map-intel-trends" className="dash-map-intel__section-title">
          Trends (diagnostics)
        </h5>
        <label className="dash-map-intel__chk">
          <input type="checkbox" checked={showEndpointTrend} onChange={(e) => setShowEndpointTrend(e.target.checked)} />
          Endpoint window (1h)
        </label>
        <label className="dash-map-intel__chk">
          <input
            type="checkbox"
            checked={showDeviceTrend}
            onChange={(e) => setShowDeviceTrend(e.target.checked)}
            disabled={!selected?.entityId}
          />
          Device window (1h)
        </label>
        {trendSummary ? <p className="dash-map-intel__muted">{trendSummary}</p> : null}
      </section>
    </aside>
  );
}
