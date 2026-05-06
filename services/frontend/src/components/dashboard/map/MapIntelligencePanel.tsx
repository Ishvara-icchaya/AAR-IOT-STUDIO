import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
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
  entityId?: string;
  display_name?: string;
  mobility_type?: string;
  freshness_status?: Freshness;
  last_observed_at?: string | null;
  latest_kpis?: Record<string, unknown>;
  expected_frequency_sec?: number;
};

export type MapIntelMode = "runtime" | "historical";

export type MapIntelligencePanelProps = {
  siteId: string;
  kpiKeys: string[];
  /** Dominant endpoint on the map, or null for site-wide roster. */
  endpointId: string | null;
  expanded: boolean;
  /** Runtime vs Historical — owned by parent; toggles rendered in this panel. */
  intelMode: MapIntelMode;
  onIntelModeChange: (mode: MapIntelMode) => void;
  onIntelOverlay: (state: IntelOverlayState | null) => void;
  /** MapLibre host element (expanded cockpit row 1 / col 1). */
  mapCanvas: ReactNode;
  /** Layer controls + legend (row 1 / col 2). */
  layersPanel: ReactNode;
};

function freshnessPillClass(s: string | undefined): string {
  const x = (s ?? "").toLowerCase();
  if (x === "active") return "dm-pill dm-pill--neon";
  if (x === "stale") return "dm-pill dm-pill--warn";
  if (x === "offline") return "dm-pill dm-pill--bad";
  return "dm-pill dm-pill--muted";
}

function formatDetailCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v).slice(0, 160);
    } catch {
      return "—";
    }
  }
  return String(v).slice(0, 220);
}

function detailSummaryRows(detail: Record<string, unknown> | null): { key: string; value: string }[] {
  if (!detail || typeof detail !== "object") return [];
  return Object.entries(detail)
    .slice(0, 28)
    .map(([key, value]) => ({ key, value: formatDetailCell(value) }));
}

function rollupCandidateKeys(
  payload: Record<string, unknown> | null,
  selected: MapIntelligenceDeviceRow | null,
  detail: Record<string, unknown> | null,
  kpiKeys: string[],
): string[] {
  const set = new Set<string>();
  for (const k of kpiKeys) {
    const t = k.trim();
    if (t) set.add(t);
  }
  const addObj = (o: unknown) => {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const key of Object.keys(o as Record<string, unknown>)) set.add(key);
    }
  };
  addObj(payload?.aggregate_kpis);
  addObj(selected?.latest_kpis);
  addObj(detail);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function formatRollupScalar(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 96);
  return String(v);
}

function rollupValueForKey(
  key: string,
  payload: Record<string, unknown> | null,
  selected: MapIntelligenceDeviceRow | null,
  detail: Record<string, unknown> | null,
): string {
  if (selected) {
    const d = detail?.[key];
    if (d !== undefined) return formatRollupScalar(d);
    const lk = selected.latest_kpis?.[key];
    if (lk !== undefined) return formatRollupScalar(lk);
  }
  const agg = payload?.aggregate_kpis as Record<string, unknown> | undefined;
  if (agg && key in agg) return formatRollupScalar(agg[key]);
  return "—";
}

export function MapIntelligencePanel({
  siteId,
  kpiKeys,
  endpointId,
  expanded,
  intelMode: mode,
  onIntelModeChange,
  onIntelOverlay,
  mapCanvas,
  layersPanel,
}: MapIntelligencePanelProps) {
  const searchId = useId();
  /** Stable for effect deps — parent often passes `?? []` (new array reference each render when empty). */
  const kpiKeysSig = kpiKeys.join("\u0001");
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
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [rollupDisplayedKeys, setRollupDisplayedKeys] = useState<string[]>([]);
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
      setErr(e instanceof Error ? e.message : "Advanced panel load failed");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [expanded, siteId, endpointId, mode, kpiKeysSig]);

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
    return devices.filter(
      (d) =>
        (d.display_name ?? "").toLowerCase().includes(q) || (d.entityId ?? "").toLowerCase().includes(q),
    );
  }, [devices, search]);

  const PAGE_SIZE = 4;
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

  const siteDisplay =
    (typeof payload?.site_name === "string" && payload.site_name.trim()) ||
    (typeof payload?.site_display_name === "string" && payload.site_display_name.trim()) ||
    (typeof ep?.site_name === "string" && String(ep.site_name).trim()) ||
    "—";

  const rollupStorageKey = `map-intel-rollup-keys:${siteId}:${endpointId ?? "all"}`;
  const rollupAllKeys = useMemo(
    () => rollupCandidateKeys(payload, selected, detail, kpiKeys),
    [payload, selected, detail, kpiKeysSig],
  );
  /** Detail payload changes often (modal); do not drive auto-fill or grid relayout from it. */
  const rollupKeysEpochStable = useMemo(
    () => rollupCandidateKeys(payload, selected, null, kpiKeys).join("\u0001"),
    [payload, selected?.source_id, kpiKeysSig, siteId, endpointId],
  );

  useEffect(() => {
    const all = rollupCandidateKeys(payload, selected, null, kpiKeys);
    setRollupDisplayedKeys((prev) => {
      const kept = prev.filter((k) => all.includes(k));
      const prio = kpiKeys.map((k) => k.trim()).filter(Boolean);
      let next = [...kept];
      for (const k of prio) {
        if (all.includes(k) && !next.includes(k) && next.length < 5) next.push(k);
      }
      for (const k of all) {
        if (next.length >= 5) break;
        if (!next.includes(k)) next.push(k);
      }
      next = next.slice(0, 5);
      if (next.length === prev.length && next.every((k, i) => k === prev[i])) return prev;
      return next;
    });
  }, [rollupKeysEpochStable, kpiKeysSig, kpiKeys, siteId, endpointId, payload, selected?.source_id]);

  const persistRollupKeys = useCallback(
    (keys: string[]) => {
      const trimmed = keys.filter((k) => rollupAllKeys.includes(k)).slice(0, 5);
      try {
        sessionStorage.setItem(rollupStorageKey, JSON.stringify(trimmed));
      } catch {
        /* ignore */
      }
      setRollupDisplayedKeys(trimmed);
    },
    [rollupAllKeys, rollupStorageKey],
  );

  const loadDetail = useCallback(
    async (row: MapIntelligenceDeviceRow, openModalAfter = false) => {
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
        if (openModalAfter) setDetailModalOpen(true);
      }
    },
    [siteId, kpiKeysSig],
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
  }, [showEndpointTrend, showDeviceTrend, siteId, kpiKeysSig, selected?.entityId, trendContextKey]);

  const modalDetailRows = useMemo(() => detailSummaryRows(detail), [detail]);

  return (
    <div className="dash-map-widget__expanded-split" role="region" aria-label="Advanced map intelligence">
      <section className="dash-map-widget__expanded-map dash-map-widget__panel">
        <header className="dash-map-widget__panel-head dash-map-widget__panel-head--split">
          <h3 className="dash-map-widget__panel-title">Map</h3>
          <div className="map-intelligence-panel__mode-row map-intelligence-panel__mode-row--head" role="group" aria-label="Runtime or historical map mode">
            <button
              type="button"
              className={`map-intelligence-panel__mode-btn ${mode === "runtime" ? "map-intelligence-panel__mode-btn--on" : ""}`}
              onClick={() => onIntelModeChange("runtime")}
            >
              Runtime
            </button>
            <button
              type="button"
              className={`map-intelligence-panel__mode-btn ${mode === "historical" ? "map-intelligence-panel__mode-btn--on" : ""}`}
              onClick={() => onIntelModeChange("historical")}
            >
              Historical
            </button>
          </div>
        </header>
        <div className="dash-map-widget__panel-body dash-map-widget__map-canvas">
          <div className="dash-map-widget__single-map-wrap dash-map-widget__single-map-wrap--expanded-intel">{mapCanvas}</div>
        </div>
      </section>

      <section className="dash-map-widget__layers-panel dash-map-widget__panel">
        <header className="dash-map-widget__panel-head">
          <h3 className="dash-map-widget__panel-title">Map layers</h3>
        </header>
        {layersPanel}
      </section>

      <section className="dash-map-widget__rollup-panel dash-map-widget__panel">
        <header className="dash-map-widget__panel-head">
          <h3 className="dash-map-widget__panel-title">Rollup fields</h3>
        </header>
        <div className="dash-map-widget__panel-body map-intelligence-panel__rollup-body">
          <div className="map-intelligence-panel__rollup-metrics" aria-label="Rollup KPI fields">
            {rollupDisplayedKeys.length === 0 ? (
              <p className="map-intelligence-panel__muted">No KPI fields in this scope.</p>
            ) : (
              rollupDisplayedKeys.map((key) => (
                <div key={key} className="map-intelligence-panel__rollup-metric">
                  <div className="map-intelligence-panel__rollup-metric-label">{key}</div>
                  <div className="map-intelligence-panel__rollup-metric-value">
                    {rollupValueForKey(key, payload, selected, detail)}
                  </div>
                </div>
              ))
            )}
          </div>
          {rollupAllKeys.length > 5 ? (
            <details className="map-intelligence-panel__rollup-field-picker">
              <summary className="map-intelligence-panel__rollup-field-picker-summary">Choose fields (max 5)</summary>
              <div className="map-intelligence-panel__rollup-checkboxes">
                {rollupAllKeys.map((k) => (
                  <label key={k} className="map-intelligence-panel__rollup-chk">
                    <input
                      type="checkbox"
                      checked={rollupDisplayedKeys.includes(k)}
                      disabled={!rollupDisplayedKeys.includes(k) && rollupDisplayedKeys.length >= 5}
                      onChange={() => {
                        if (rollupDisplayedKeys.includes(k)) {
                          persistRollupKeys(rollupDisplayedKeys.filter((x) => x !== k));
                        } else if (rollupDisplayedKeys.length < 5) {
                          persistRollupKeys([...rollupDisplayedKeys, k]);
                        }
                      }}
                    />
                    <span>{k}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <div className="map-intelligence-panel__rollup-trace">
            <span className="map-intelligence-panel__advanced-label">Trace / replay</span>
            {mode !== "historical" ? (
              <p className="map-intelligence-panel__muted">Switch to Historical to load paths and replay.</p>
            ) : !selected ? (
              <p className="map-intelligence-panel__muted">Select a device in the list, then load a 24h footprint.</p>
            ) : (
              <>
                <div className="dm-act-grid map-intelligence-panel__trace-actions">
                  <button
                    type="button"
                    className="dm-act-grid__btn dm-act-grid__btn--text"
                    disabled={pathLoading}
                    onClick={() => void loadPath()}
                  >
                    {pathLoading ? "Loading…" : "Load 24h footprint"}
                  </button>
                  <button
                    type="button"
                    className="dm-act-grid__btn dm-act-grid__btn--text"
                    disabled={!pathPolyline || pathPolyline.length < 2 || pathLoading}
                    title="Replay: moving head along the selected route; all loaded traces stay full length"
                    onClick={() => setReplayFrame(0)}
                  >
                    Replay path
                  </button>
                </div>
                {pathErr ? <p className="map-intelligence-panel__err">{pathErr}</p> : null}
              </>
            )}
          </div>
          <details className="map-intelligence-panel__advanced">
            <summary className="map-intelligence-panel__advanced-summary">Advanced</summary>
            <div className="map-intelligence-panel__advanced-body">
              <div className="map-intelligence-panel__trend-block">
                <span className="map-intelligence-panel__advanced-label">Trends (1h)</span>
                <div className="map-intelligence-panel__trend-row">
                  <label className="map-intelligence-panel__chk">
                    <input type="checkbox" checked={showEndpointTrend} onChange={(e) => setShowEndpointTrend(e.target.checked)} />
                    Endpoint
                  </label>
                  <label className="map-intelligence-panel__chk">
                    <input
                      type="checkbox"
                      checked={showDeviceTrend}
                      onChange={(e) => setShowDeviceTrend(e.target.checked)}
                      disabled={!selected?.entityId}
                    />
                    Device
                  </label>
                </div>
                {trendSummary ? <p className="map-intelligence-panel__muted map-intelligence-panel__muted--tight">{trendSummary}</p> : null}
              </div>
              {detail && Object.keys(detail).length ? (
                <pre className="map-intelligence-panel__debug-pre">{JSON.stringify(detail, null, 2).slice(0, 4000)}</pre>
              ) : null}
            </div>
          </details>
        </div>
      </section>

      <div className="dash-map-widget__mid-grid">
        <section className="dash-map-widget__endpoint-summary dash-map-widget__panel">
          <header className="dash-map-widget__panel-head">
            <h3 className="dash-map-widget__panel-title">Endpoint summary</h3>
          </header>
          <div className="dash-map-widget__panel-body">
            {!siteId ? (
              <p className="map-intelligence-panel__err" role="status">
                This map has no site in its binding. Configure a site on the widget so this view can load roster and trends.
              </p>
            ) : loading && !payload ? (
              <p className="map-intelligence-panel__muted">Loading…</p>
            ) : err ? (
              <p className="map-intelligence-panel__err">{err}</p>
            ) : (
              <>
                <div className="map-intelligence-panel__metric-grid">
                  <div className="map-intelligence-panel__metric">
                    <div className="map-intelligence-panel__metric-label">Site Name</div>
                    <div className="map-intelligence-panel__metric-value map-intelligence-panel__metric-value--truncate" title={siteDisplay}>
                      {siteDisplay}
                    </div>
                  </div>
                  <div className="map-intelligence-panel__metric">
                    <div className="map-intelligence-panel__metric-label">Endpoint</div>
                    <div
                      className="map-intelligence-panel__metric-value map-intelligence-panel__metric-value--truncate"
                      title={ep?.name ? String(ep.name) : ""}
                    >
                      {ep?.name ? String(ep.name) : "—"}
                    </div>
                  </div>
                  <div className="map-intelligence-panel__metric">
                    <div className="map-intelligence-panel__metric-label">Devices</div>
                    <div className="map-intelligence-panel__metric-value">
                      {typeof ep?.device_count === "number" ? ep.device_count : devices.length}
                    </div>
                  </div>
                  <div className="map-intelligence-panel__metric">
                    <div className="map-intelligence-panel__metric-label">Refresh</div>
                    <div className="map-intelligence-panel__metric-value map-intelligence-panel__metric-value--sm">
                      every {refreshSec}s
                      {typeof payload?.observable_window_sec === "number"
                        ? ` · stale ≥ ${String(payload.observable_window_sec)}s`
                        : null}
                    </div>
                  </div>
                </div>
                <div className="map-intelligence-panel__status-row" aria-label="Freshness counts">
                  <span className="dm-pill dm-pill--neon" title="Active">
                    A {typeof ep?.active_count === "number" ? ep.active_count : "—"}
                  </span>
                  <span className="dm-pill dm-pill--warn" title="Stale">
                    S {typeof ep?.stale_count === "number" ? ep.stale_count : "—"}
                  </span>
                  <span className="dm-pill dm-pill--bad" title="Offline">
                    O {typeof ep?.offline_count === "number" ? ep.offline_count : "—"}
                  </span>
                  <span className="dm-pill dm-pill--muted" title="Unknown">
                    ? {typeof ep?.unknown_count === "number" ? ep.unknown_count : "—"}
                  </span>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="dash-map-widget__device-list dash-map-widget__panel">
          <header className="dash-map-widget__panel-head">
            <h3 className="dash-map-widget__panel-title">Device list</h3>
          </header>
          <div className="dash-map-widget__panel-body">
            <div className="map-intelligence-panel__device-toolbar">
              <div className="map-intelligence-panel__segment" role="group" aria-label="List source">
                <button
                  type="button"
                  className={`map-intelligence-panel__segment-btn ${listKind === "devices" ? "map-intelligence-panel__segment-btn--on" : ""}`}
                  onClick={() => setListKind("devices")}
                >
                  Devices
                </button>
                <button
                  type="button"
                  className={`map-intelligence-panel__segment-btn ${listKind === "endpoint" ? "map-intelligence-panel__segment-btn--on" : ""}`}
                  onClick={() => setListKind("endpoint")}
                >
                  Endpoint
                </button>
              </div>
              {listKind === "devices" ? (
                <div className="map-intelligence-panel__filter-inline dm-filter-field">
                  <label className="dm-filter-field__label" htmlFor={searchId}>
                    Filter devices
                  </label>
                  <input
                    id={searchId}
                    type="search"
                    placeholder="Name or id…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
        {listKind === "devices" ? (
          <>
            <div className="map-intelligence-panel__table-shell">
              <table className="dm-data-table map-intelligence-panel__device-table">
                <thead>
                  <tr>
                    <th className="dm-data-table__th" scope="col">
                      Device
                    </th>
                    <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                      State
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Mobility
                    </th>
                    <th className="dm-data-table__th" scope="col">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.length === 0 ? (
                    <tr className="dm-data-table__row">
                      <td className="dm-data-table__td dm-data-table__td--muted" colSpan={4}>
                        {loading && !payload
                          ? "Loading…"
                          : err
                            ? String(err)
                            : devices.length === 0
                              ? "No devices in this scope."
                              : "No matches. Clear the filter."}
                      </td>
                    </tr>
                  ) : (
                    pageSlice.map((d) => (
                      <tr
                        key={d.source_id}
                        className={`dm-data-table__row ${selected?.source_id === d.source_id ? "map-intelligence-panel__tr--selected" : ""}`}
                      >
                        <td className="dm-data-table__td">
                          <button type="button" className="map-intelligence-panel__device-link" onClick={() => void loadDetail(d, true)}>
                            {d.display_name ?? d.entityId}
                          </button>
                        </td>
                        <td className="dm-data-table__td dm-data-table__td--center">
                          <span className={freshnessPillClass(d.freshness_status)}>{d.freshness_status ?? "—"}</span>
                        </td>
                        <td className="dm-data-table__td">{d.mobility_type ?? "—"}</td>
                        <td className="dm-data-table__td map-intelligence-panel__td-compact">
                          {d.last_observed_at ? new Date(d.last_observed_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {sortedDevices.length > PAGE_SIZE ? (
              <div className="dm-table-pager map-intelligence-panel__pager">
                <div className="dm-table-pager__controls">
                  <button
                    type="button"
                    className="dm-act-grid__btn dm-act-grid__btn--text"
                    disabled={devicePageClamped <= 1}
                    onClick={() => setDevicePage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="dm-act-grid__btn dm-act-grid__btn--text"
                    disabled={devicePageClamped >= deviceTotalPages}
                    onClick={() => setDevicePage((p) => Math.min(deviceTotalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
                <span className="map-intelligence-panel__pager-note">
                  {devicePageClamped} / {deviceTotalPages} · {sortedDevices.length} devices
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="map-intelligence-panel__table-shell">
            <table className="dm-data-table map-intelligence-panel__device-table">
              <thead>
                <tr>
                  <th className="dm-data-table__th" scope="col">
                    Endpoint
                  </th>
                  <th className="dm-data-table__th dm-data-table__th--center" scope="col">
                    Devices
                  </th>
                  <th className="dm-data-table__th" scope="col">
                    A / S / O / ?
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="dm-data-table__row">
                  <td className="dm-data-table__td">{ep?.name ? String(ep.name) : "—"}</td>
                  <td className="dm-data-table__td dm-data-table__td--center">
                    {typeof ep?.device_count === "number" ? ep.device_count : devices.length}
                  </td>
                  <td className="dm-data-table__td dm-data-table__td--muted">
                    {typeof ep?.active_count === "number" ? ep.active_count : "—"} /{" "}
                    {typeof ep?.stale_count === "number" ? ep.stale_count : "—"} /{" "}
                    {typeof ep?.offline_count === "number" ? ep.offline_count : "—"} /{" "}
                    {typeof ep?.unknown_count === "number" ? ep.unknown_count : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="map-intelligence-panel__hint">Open the Devices tab to select a row for detail and trace tools.</p>
          </div>
        )}
          </div>
        </section>

      </div>

      <AppModalShell
        open={detailModalOpen}
        title={selected ? String(selected.display_name ?? selected.entityId ?? "Device") : "Device detail"}
        subtitle={selected?.entityId ? `Entity: ${selected.entityId}` : undefined}
        onClose={() => setDetailModalOpen(false)}
        size="lg"
        dialogClassName="map-intelligence-panel__detail-modal"
      >
        {!selected ? (
          <p className="map-intelligence-panel__muted">No device selected.</p>
        ) : detailLoading ? (
          <p className="map-intelligence-panel__muted">Loading detail…</p>
        ) : (
          <>
            <div className="map-intelligence-panel__selected-head">
              <span className="map-intelligence-panel__selected-name">{selected.display_name ?? selected.entityId}</span>
              <span className="dm-pill dm-pill--muted">{selected.mobility_type ?? "unknown"}</span>
            </div>
            {modalDetailRows.length > 0 ? (
              <div className="map-intelligence-panel__kv map-intelligence-panel__kv--modal">
                {modalDetailRows.map((row) => (
                  <div key={row.key} className="map-intelligence-panel__row">
                    <span className="map-intelligence-panel__row-k">{row.key}</span>
                    <span className="map-intelligence-panel__row-v" title={row.value}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="map-intelligence-panel__muted">No detail payload.</p>
            )}
          </>
        )}
      </AppModalShell>
    </div>
  );
}
