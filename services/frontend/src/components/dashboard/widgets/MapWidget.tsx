import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DashboardLiveWidgetDTO, EnterpriseSiteObjectCountsDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { useDashboardLiveRuntime } from "@/components/dashboard/DashboardLiveContext";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { OFFLINE_FALLBACK_MAP_STYLE } from "@/lib/dashboardMapStyle";
import { getEnterpriseSiteObjectCounts, postMapMarkersQuery } from "@/api/dashboard";
import {
  attachDeckSiteMapOverlay,
  type DeckSiteMapHandle,
  type IntelOverlayState,
} from "@/components/dashboard/map/deckOverlaySiteMap";
import {
  adaptMapChrome,
  buildMarkersQueryBody,
  mapChromeFetchKey,
  parseMapInit,
  type MapControlsVM,
  type MapInitVM,
} from "@/lib/dashboard/adapters/mapChromeAdapter";
import type { MarkerRec } from "@/lib/dashboard/adapters/apiMarkersToRec";
import { apiMarkersToMarkerRecs } from "@/lib/dashboard/adapters/apiMarkersToRec";
import { markersToViewModels, type MapPointVM, type MapProfile } from "@/lib/dashboard/mapViewModel";
import { openDashboardMapMarkerPopup } from "@/components/dashboard/map/mountMapMarkerPopup";
import { MapIntelligencePanel } from "@/components/dashboard/map/MapIntelligencePanel";

function computeClusterEffective(list: MarkerRec[], controls: MapControlsVM): boolean {
  const n = list.length;
  const max = Math.max(10, Math.min(500, controls.max_direct_markers ?? 80));
  if (n > max) return true;
  return controls.cluster_markers !== false;
}

function markersFingerprint(list: MarkerRec[]): string {
  return list
    .map((m) => `${String(m.source_id ?? "")}:${m.latitude.toFixed(5)}:${m.longitude.toFixed(5)}`)
    .sort()
    .join("|");
}

function dataSyncKey(list: MarkerRec[], controls: MapControlsVM): string {
  const cluster = computeClusterEffective(list, controls) ? "1" : "0";
  const mc = JSON.stringify(controls);
  return `${markersFingerprint(list)}|${cluster}|${mc}`;
}

/** Pick the most common endpoint_id on markers for intelligence API filtering. */
function dominantEndpointId(markers: MarkerRec[]): string | null {
  const counts = new Map<string, number>();
  for (const m of markers) {
    const e = m.endpoint_id;
    if (!e) continue;
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  counts.forEach((n, id) => {
    if (n > max) {
      max = n;
      best = id;
    }
  });
  return best;
}

function openMapPopupForVm(
  map: maplibregl.Map,
  vm: MapPointVM,
  getSiteId: () => string | undefined,
  extra?: { kpiKeys?: string[]; trendScope?: "resolved_device" | "endpoint" | "site" },
) {
  const lngLat: maplibregl.LngLatLike = [vm.longitude, vm.latitude];
  const siteId = getSiteId();
  const st = vm.source_type;
  const sid = vm.source_id;
  const displayName = vm.label || "Object";

  if (!siteId || !st || !sid) {
    openDashboardMapMarkerPopup(map, {
      lngLat,
      title: displayName,
      siteId: siteId ?? "",
      sourceType: String(st ?? ""),
      sourceId: String(sid ?? ""),
      blockedMessage: "No detail link (missing site or source).",
    });
    return;
  }

  openDashboardMapMarkerPopup(map, {
    lngLat,
    title: displayName,
    siteId,
    sourceType: String(st),
    sourceId: String(sid),
    kpiKeys: extra?.kpiKeys,
    trendScope: extra?.trendScope,
  });
}

function applyViewport(
  map: maplibregl.Map,
  list: MarkerRec[],
  init: MapInitVM | undefined,
  controls: MapControlsVM,
  firstFitDoneRef: { current: boolean },
) {
  if (list.length === 0) return;

  const isFirstFitWindow = !firstFitDoneRef.current;

  if (isFirstFitWindow) {
    if (controls.auto_fit_on_first_load !== false) {
      if (init?.bounds && init.bounds[0] && init.bounds[1]) {
        const b = new maplibregl.LngLatBounds(init.bounds[0], init.bounds[1]);
        map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 0 });
      } else if (init?.center) {
        map.jumpTo({ center: init.center, zoom: init.zoom ?? 10 });
      } else if (list.length === 1) {
        map.jumpTo({ center: [list[0].longitude, list[0].latitude], zoom: 13 });
      } else {
        const bounds = new maplibregl.LngLatBounds();
        for (const m of list) bounds.extend([m.longitude, m.latitude]);
        map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
      }
    }
    firstFitDoneRef.current = true;
    return;
  }

  if (!isFirstFitWindow && controls.auto_fit_on_refresh === true) {
    if (init?.bounds && init.bounds[0] && init.bounds[1]) {
      const b = new maplibregl.LngLatBounds(init.bounds[0], init.bounds[1]);
      map.fitBounds(b, { padding: 40, maxZoom: 14, duration: 350 });
    } else {
      const bounds = new maplibregl.LngLatBounds();
      for (const m of list) bounds.extend([m.longitude, m.latitude]);
      map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 350 });
    }
    return;
  }

  // Subsequent refreshes: preserve viewport unless auto_fit_on_refresh is enabled (handled above).
}

const ENTERPRISE_COUNTS_PAGE_SIZE = 8;

function EnterpriseSiteCountsPanel() {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<EnterpriseSiteObjectCountsDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const r = await getEnterpriseSiteObjectCounts({ page, page_size: ENTERPRISE_COUNTS_PAGE_SIZE });
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed to load counts");
          setData(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const totalPages =
    data && data.page_size > 0 ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="dash-map-widget__side">
      <div className="dash-map-widget__side-table-wrap">
        <div className="dash-map-widget__side-title">Sites by volume</div>
        {loading ? (
          <p className="dash-widget__muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
            Loading…
          </p>
        ) : err ? (
          <p style={{ color: "#f66", margin: "0.25rem 0 0", fontSize: "0.72rem" }}>{err}</p>
        ) : !data?.items.length ? (
          <p className="dash-widget__muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
            No sites
          </p>
        ) : (
          <table className="dash-map-widget__count-table">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col" className="dash-map-widget__num">
                  Data obj.
                </th>
                <th scope="col" className="dash-map-widget__num">
                  Result obj.
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.site_id}>
                  <td className="dash-map-widget__cell-name" title={row.site_name}>
                    {row.site_name}
                  </td>
                  <td className="dash-map-widget__num">{row.data_object_count}</td>
                  <td className="dash-map-widget__num">{row.result_object_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="dash-map-widget__side-pager">
        <button
          type="button"
          className="dash-map-widget__pager-btn"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Prev
        </button>
        <span className="dash-map-widget__pager-meta">
          {data ? `Page ${data.page} / ${totalPages}` : "—"}
        </span>
        <button
          type="button"
          className="dash-map-widget__pager-btn"
          disabled={loading || !data || page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function MapWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const { mapStyleUrl, enterpriseMode } = useDashboardLiveRuntime();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latestBlockRef = useRef(block);
  latestBlockRef.current = block;

  const firstFitDoneRef = useRef(false);
  const deckHandleRef = useRef<DeckSiteMapHandle | null>(null);

  const d = block.data ?? {};
  const [styleNotice, setStyleNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [intelOverlay, setIntelOverlay] = useState<IntelOverlayState | null>(null);

  const chrome = adaptMapChrome(block);
  const fetchKey = mapChromeFetchKey(chrome);

  const [markerList, setMarkerList] = useState<MarkerRec[]>([]);
  const [mapInitApi, setMapInitApi] = useState<MapInitVM | undefined>(undefined);
  const [markerFetch, setMarkerFetch] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [markerError, setMarkerError] = useState<string | null>(null);

  const markerListRef = useRef(markerList);
  markerListRef.current = markerList;
  const mapInitApiRef = useRef(mapInitApi);
  mapInitApiRef.current = mapInitApi;

  const controls = chrome.mapControls;
  const syncKey = useMemo(() => dataSyncKey(markerList, controls), [markerList, controls]);

  useEffect(() => {
    if (d.error) return;
    const body = buildMarkersQueryBody(chrome);
    if (!body) {
      setMarkerList([]);
      setMapInitApi(undefined);
      setMarkerFetch("error");
      setMarkerError(chrome.siteId ? "Invalid map marker query (check binding)." : "Map requires a site.");
      return;
    }
    let cancelled = false;
    setMarkerFetch("loading");
    setMarkerError(null);
    void (async () => {
      try {
        const r = await postMapMarkersQuery(body);
        if (cancelled) return;
        if (!r) throw new Error("Empty response from map markers API");
        setMarkerList(apiMarkersToMarkerRecs(r.markers));
        setMapInitApi(r.map_init ? parseMapInit(r.map_init) : undefined);
        setMarkerFetch("ok");
      } catch (e) {
        if (cancelled) return;
        setMarkerList([]);
        setMapInitApi(undefined);
        setMarkerFetch("error");
        setMarkerError(e instanceof Error ? e.message : "Failed to load map markers");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchKey, block.widget_id, d.error]);

  useEffect(() => {
    firstFitDoneRef.current = false;
  }, [block.widget_id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let styleFallbackUsed = false;
    const chrome0 = adaptMapChrome(latestBlockRef.current);
    const init = chrome0.mapInitHint;
    const center = init?.center ?? [0, 20];
    const zoom = typeof init?.zoom === "number" ? init.zoom : 1;

    const map = new maplibregl.Map({
      container,
      style: mapStyleUrl,
      center: center as [number, number],
      zoom,
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 160, unit: "metric" }), "bottom-left");

    map.on("error", () => {
      if (styleFallbackUsed) return;
      styleFallbackUsed = true;
      try {
        map.setStyle(OFFLINE_FALLBACK_MAP_STYLE as unknown as StyleSpecification);
        setStyleNotice("External map style failed to load; using offline background (no tiles).");
      } catch {
        setStyleNotice("Map style error; markers may not display correctly.");
      }
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    return () => {
      ro.disconnect();
      deckHandleRef.current?.dispose();
      deckHandleRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyleUrl, block.widget_id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      const b = latestBlockRef.current;
      const list = markerListRef.current;
      const chromeNow = adaptMapChrome(b);
      const ctrl = chromeNow.mapControls;
      const init = mapInitApiRef.current ?? chromeNow.mapInitHint;
      const useCluster = computeClusterEffective(list, ctrl);
      const profile: MapProfile = chromeNow.mapProfile === "fleet" ? "fleet" : "site";
      const vms = markersToViewModels(list, profile);

      if (!deckHandleRef.current) {
        deckHandleRef.current = attachDeckSiteMapOverlay(map, {
          profile,
          onPointPick: (vm) => {
            const ch = adaptMapChrome(latestBlockRef.current);
            const kpiKeys = ch.kpiFields?.length ? ch.kpiFields : undefined;
            const trendScope =
              vm.source_type === "latest_device_state" && ch.mapDefaultTrendScope
                ? ch.mapDefaultTrendScope
                : undefined;
            openMapPopupForVm(
              map,
              vm,
              () => {
                const site = latestBlockRef.current.data?.site_id;
                return typeof site === "string" ? site : undefined;
              },
              { kpiKeys, trendScope },
            );
          },
          onClusterPick: (clusterId, lngLat, expansionZoom) => {
            const deck = deckHandleRef.current;
            const siteRaw = latestBlockRef.current.data?.site_id;
            const siteStr = typeof siteRaw === "string" ? siteRaw : undefined;
            const leaves = deck?.getClusterLeaves(clusterId) ?? [];
            const epSet = new Set(
              leaves.map((l) => l.endpoint_id).filter((x): x is string => Boolean(x)),
            );
            const stSet = new Set(
              leaves.map((l) => l.source_type).filter((x): x is string => Boolean(x)),
            );
            const homogenousLds =
              leaves.length > 0 &&
              epSet.size === 1 &&
              stSet.size === 1 &&
              [...stSet][0] === "latest_device_state";
            if (homogenousLds && siteStr) {
              const rep = leaves[0]!;
              const sid = rep.source_id;
              if (sid) {
                const ch = adaptMapChrome(latestBlockRef.current);
                const kpiKeys = ch.kpiFields?.length ? ch.kpiFields : undefined;
                openDashboardMapMarkerPopup(map, {
                  lngLat,
                  title: `${rep.label} (${leaves.length})`,
                  siteId: siteStr,
                  sourceType: "latest_device_state",
                  sourceId: sid,
                  trendScope: "endpoint",
                  kpiKeys,
                });
                return;
              }
            }
            map.easeTo({
              center: lngLat,
              zoom: Math.max(expansionZoom, map.getZoom() + 0.5),
              duration: 250,
            });
          },
        });
      }
      deckHandleRef.current.updatePoints(vms, useCluster);
      applyViewport(map, list, init, ctrl, firstFitDoneRef);
    };

    if (map.isStyleLoaded()) {
      run();
    } else {
      map.once("load", run);
    }

    return () => {
      cancelled = true;
      map.off("load", run);
    };
  }, [syncKey, mapStyleUrl, block.widget_id, markerFetch]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => map.resize());
    });
    return () => cancelAnimationFrame(id);
  }, [expanded]);

  useEffect(() => {
    deckHandleRef.current?.setIntelligenceOverlay?.(intelOverlay);
  }, [intelOverlay, syncKey]);

  useEffect(() => {
    if (!expanded) setIntelOverlay(null);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (d.error) {
    return (
      <DashboardWidgetFrame
        block={block}
        presentation={pres}
        state="error"
        widgetKind="map"
        errorMessage={String(d.error)}
      />
    );
  }

  const markerStatusNote =
    markerFetch === "loading"
      ? "Loading markers…"
      : markerFetch === "error"
        ? markerError ?? "Markers unavailable"
        : null;

  const isEnterprise = enterpriseMode === true;
  const intelEndpointId = dominantEndpointId(markerList);
  const intelSiteId = chrome.siteId ?? "";

  const mapEl = (
    <div
      ref={containerRef}
      className="dash-map-widget__map"
      style={
        isEnterprise
          ? {
              minHeight: 0,
              width: "100%",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              flex: "0 0 auto",
            }
          : {
              width: "100%",
              height: "100%",
              minHeight: 0,
              flex: "1 1 auto",
              borderRadius: "var(--radius)",
              overflow: "hidden",
            }
      }
    />
  );

  const mapModifiers = [
    "dash-widget--map",
    "widget--map",
    isEnterprise ? "dash-map-widget--enterprise" : "",
    expanded ? "dash-map-widget--expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const expandBtn = (
    <button
      type="button"
      className="dash-map-widget__expand-btn"
      onClick={() => setExpanded((x) => !x)}
      aria-expanded={expanded}
      title={expanded ? "Close expanded intelligence view" : "Open expanded map intelligence (split layout)"}
    >
      {expanded ? "Close view" : "Intelligence view"}
    </button>
  );

  return (
    <>
      {expanded ? (
        <button
          type="button"
          className="dash-map-widget__backdrop"
          aria-label="Close expanded map"
          onClick={() => setExpanded(false)}
        />
      ) : null}
      <DashboardWidgetFrame
        block={block}
        presentation={pres}
        state="normal"
        widgetKind="map"
        bodyFill
        className={mapModifiers}
        headerExtra={expandBtn}
        rootProps={
          expanded
            ? {
                role: "dialog",
                "aria-modal": true,
                "aria-label": `Expanded map intelligence — ${block.title}`,
              }
            : undefined
        }
      >
        {styleNotice ? (
          <p className="dash-widget__muted dash-wf-map__notice">{styleNotice}</p>
        ) : null}
        {markerStatusNote ? (
          <p className="dash-widget__muted dash-wf-map__notice" role="status">
            {markerStatusNote}
          </p>
        ) : null}
        {chrome.degraded && chrome.warning ? (
          <p className="dash-widget__muted dash-wf-map__notice" role="status">
            {chrome.warning}
          </p>
        ) : null}
        {expanded ? (
          <div className="dash-map-widget__expanded-split">
            <div className="dash-map-widget__expanded-map-col">
              <div className="dash-map-widget__single-map-wrap dash-map-widget__single-map-wrap--expanded-intel">
                {mapEl}
              </div>
            </div>
            <MapIntelligencePanel
              siteId={intelSiteId}
              blockTitle={block.title?.trim() || "Map"}
              kpiKeys={chrome.kpiFields ?? []}
              endpointId={intelEndpointId}
              expanded={expanded}
              onIntelOverlay={setIntelOverlay}
            />
          </div>
        ) : isEnterprise ? (
          <div className="dash-map-widget__enterprise-grid">
            <div className="dash-map-widget__map-col">{mapEl}</div>
            <EnterpriseSiteCountsPanel />
          </div>
        ) : (
          <div className="dash-map-widget__single-map-wrap">{mapEl}</div>
        )}
      </DashboardWidgetFrame>
    </>
  );
}

