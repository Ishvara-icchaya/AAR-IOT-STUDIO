import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MapLayerControlPanel } from "@/components/dashboard/map/MapLayerControlPanel";
import { MapLayerLegend } from "@/components/dashboard/map/MapLayerLegend";
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
  bindingFingerprintFromKey,
  buildMarkersQueryBody,
  mapChromeFetchKey,
  parseMapInit,
  type MapControlsVM,
  type MapInitVM,
} from "@/lib/dashboard/adapters/mapChromeAdapter";
import type { RichMapPoint } from "@/types/mapTransport";
import type { MarkerRec } from "@/lib/dashboard/adapters/apiMarkersToRec";
import { apiMarkersToMarkerRecs } from "@/lib/dashboard/adapters/apiMarkersToRec";
import { markersToViewModels, type MapPointVM, type MapProfile } from "@/lib/dashboard/mapViewModel";
import { MapMarkerPopupRoot } from "@/components/dashboard/map/MapMarkerPopupRoot";
import { openDashboardMapMarkerPopup } from "@/components/dashboard/map/mountMapMarkerPopup";
import { MapIntelligencePanel } from "@/components/dashboard/map/MapIntelligencePanel";
import {
  filterMarkersForLayers,
  parseMapLayerControlsFromBlock,
  type MapLayerControls,
} from "@/lib/dashboard/mapLayerControls";

/** Docked marker detail (non–Intelligence standard map); same props shape as MapMarkerPopupRoot. */
type MapInlineMarkerDetail = {
  siteId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  blockedMessage?: string;
  trendScope?: "resolved_device" | "endpoint" | "site";
  kpiKeys?: string[];
};

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
  extra?: {
    kpiKeys?: string[];
    trendScope?: "resolved_device" | "endpoint" | "site";
    expandedMapIntel?: boolean;
    detailRefreshIntervalSec?: number;
    detailRenderEpoch?: string;
  },
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
      expandedMapIntel: extra?.expandedMapIntel,
      detailRefreshIntervalSec: extra?.detailRefreshIntervalSec,
      detailRenderEpoch: extra?.detailRenderEpoch,
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
    expandedMapIntel: extra?.expandedMapIntel,
    detailRefreshIntervalSec: extra?.detailRefreshIntervalSec,
    detailRenderEpoch: extra?.detailRenderEpoch,
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
  const { mapStyleUrl, enterpriseMode, renderedAt, refreshIntervalSec } = useDashboardLiveRuntime();
  const enterpriseModeRef = useRef(enterpriseMode);
  enterpriseModeRef.current = enterpriseMode;
  const livePopupMetaRef = useRef({ renderedAt, refreshIntervalSec });
  livePopupMetaRef.current = { renderedAt, refreshIntervalSec };

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
  const [inlineMarkerDetail, setInlineMarkerDetail] = useState<MapInlineMarkerDetail | null>(null);

  const chrome = adaptMapChrome(block);
  const fetchKey = mapChromeFetchKey(chrome);
  const markerBindingFingerprint = useMemo(
    () => bindingFingerprintFromKey(`${fetchKey}|wid:${block.widget_id}`),
    [fetchKey, block.widget_id],
  );

  const [markerList, setMarkerList] = useState<MarkerRec[]>([]);
  const [layerControls, setLayerControls] = useState<MapLayerControls>(() => parseMapLayerControlsFromBlock(block));
  const configLayerSig = useMemo(
    () => JSON.stringify(block.config?.mapLayerControls ?? block.config?.map_layer_controls ?? null),
    [block.widget_id, block.config],
  );
  const prevLayerSigRef = useRef(configLayerSig);
  useEffect(() => {
    if (prevLayerSigRef.current === configLayerSig) return;
    prevLayerSigRef.current = configLayerSig;
    setLayerControls(parseMapLayerControlsFromBlock(block));
  }, [block, configLayerSig]);

  const filteredMarkers = useMemo(
    () => filterMarkersForLayers(markerList, layerControls),
    [markerList, layerControls],
  );

  const [smoothMarkers, setSmoothMarkers] = useState<MarkerRec[]>([]);
  const [mapInitApi, setMapInitApi] = useState<MapInitVM | undefined>(undefined);
  const [markerFetch, setMarkerFetch] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [markerError, setMarkerError] = useState<string | null>(null);

  const layerControlsRef = useRef(layerControls);
  layerControlsRef.current = layerControls;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const markerPickTsRef = useRef(0);

  const smoothMarkersRef = useRef(smoothMarkers);
  smoothMarkersRef.current = smoothMarkers;
  const mapInitApiRef = useRef(mapInitApi);
  mapInitApiRef.current = mapInitApi;

  const controls = chrome.mapControls;
  const syncKey = useMemo(
    () => `${dataSyncKey(smoothMarkers, controls)}|lc:${JSON.stringify(layerControls)}`,
    [smoothMarkers, controls, layerControls],
  );

  useEffect(() => {
    const ch = adaptMapChrome(block);
    if (!ch.mapSmoothMarkers) {
      setSmoothMarkers(filteredMarkers);
      return;
    }
    const start = smoothMarkersRef.current;
    let step = 0;
    const id = window.setInterval(() => {
      step += 1;
      const u = Math.min(1, step / 14);
      const s = u * u * (3 - 2 * u);
      setSmoothMarkers(
        filteredMarkers.map((m) => {
          const o = start.find((x) => x.source_id === m.source_id && x.source_type === m.source_type);
          if (!o) return m;
          return {
            ...m,
            latitude: o.latitude + (m.latitude - o.latitude) * s,
            longitude: o.longitude + (m.longitude - o.longitude) * s,
          };
        }),
      );
      if (step >= 14) window.clearInterval(id);
    }, 32);
    return () => window.clearInterval(id);
  }, [filteredMarkers, block]);

  useEffect(() => {
    if (d.error) return;
    const body = buildMarkersQueryBody(chrome, { bindingFingerprint: markerBindingFingerprint });
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
  }, [fetchKey, block.widget_id, d.error, renderedAt, markerBindingFingerprint]);

  /** Fleet / MQTT: soft poll between dashboard resolves (capped to limit API load). */
  useEffect(() => {
    if (d.error) return;
    const sec =
      typeof refreshIntervalSec === "number" && Number.isFinite(refreshIntervalSec) && refreshIntervalSec >= 5
        ? Math.min(refreshIntervalSec, 30)
        : null;
    if (sec === null) return;
    const id = window.setInterval(() => {
      const ch = adaptMapChrome(latestBlockRef.current);
      const fp = bindingFingerprintFromKey(`${mapChromeFetchKey(ch)}|wid:${latestBlockRef.current.widget_id}`);
      const body = buildMarkersQueryBody(ch, { bindingFingerprint: fp });
      if (!body) return;
      void postMapMarkersQuery(body)
        .then((r) => {
          if (!r?.markers) return;
          setMarkerList(apiMarkersToMarkerRecs(r.markers));
          if (r.map_init) setMapInitApi(parseMapInit(r.map_init));
        })
        .catch(() => {
          /* keep last good markers */
        });
    }, sec * 1000);
    return () => window.clearInterval(id);
  }, [d.error, refreshIntervalSec, fetchKey, block.widget_id, markerBindingFingerprint]);

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

    const onMapClick = () => {
      if (expandedRef.current) return;
      if (enterpriseModeRef.current) return;
      if (Date.now() - markerPickTsRef.current < 320) return;
      setInlineMarkerDetail(null);
    };
    map.on("click", onMapClick);

    return () => {
      map.off("click", onMapClick);
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
      const list = smoothMarkersRef.current;
      const chromeNow = adaptMapChrome(b);
      const ctrl = chromeNow.mapControls;
      const init = mapInitApiRef.current ?? chromeNow.mapInitHint;
      const useCluster = computeClusterEffective(list, ctrl);
      const profile: MapProfile = chromeNow.mapProfile === "fleet" ? "fleet" : "site";
      const vms = markersToViewModels(list, profile);

      if (!deckHandleRef.current) {
        deckHandleRef.current = attachDeckSiteMapOverlay(map, {
          profile,
          initialLayerControls: parseMapLayerControlsFromBlock(latestBlockRef.current),
          onPointPick: (vm) => {
            markerPickTsRef.current = Date.now();
            const ch = adaptMapChrome(latestBlockRef.current);
            const kpiKeys = ch.kpiFields?.length ? ch.kpiFields : undefined;
            const trendScope =
              vm.source_type === "latest_device_state" && ch.mapDefaultTrendScope
                ? ch.mapDefaultTrendScope
                : undefined;
            const siteRaw = latestBlockRef.current.data?.site_id;
            const siteId = typeof siteRaw === "string" ? siteRaw : undefined;
            const st = vm.source_type;
            const sid = vm.source_id;
            const title = vm.label || "Object";

            const popExtra = {
              kpiKeys,
              trendScope,
              detailRefreshIntervalSec: livePopupMetaRef.current.refreshIntervalSec,
              detailRenderEpoch: livePopupMetaRef.current.renderedAt,
            };
            if (expandedRef.current) {
              openMapPopupForVm(
                map,
                vm,
                () => {
                  const site = latestBlockRef.current.data?.site_id;
                  return typeof site === "string" ? site : undefined;
                },
                { ...popExtra, expandedMapIntel: true },
              );
              return;
            }
            if (enterpriseModeRef.current) {
              openMapPopupForVm(
                map,
                vm,
                () => {
                  const site = latestBlockRef.current.data?.site_id;
                  return typeof site === "string" ? site : undefined;
                },
                { ...popExtra, expandedMapIntel: false },
              );
              return;
            }
            if (!siteId || !st || !sid) {
              setInlineMarkerDetail({
                siteId: siteId ?? "",
                sourceType: String(st ?? ""),
                sourceId: String(sid ?? ""),
                title,
                blockedMessage: "No detail link (missing site or source).",
                kpiKeys,
                trendScope,
              });
              return;
            }
            setInlineMarkerDetail({
              siteId,
              sourceType: String(st),
              sourceId: String(sid),
              title,
              kpiKeys,
              trendScope,
            });
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
                markerPickTsRef.current = Date.now();
                const ch = adaptMapChrome(latestBlockRef.current);
                const kpiKeys = ch.kpiFields?.length ? ch.kpiFields : undefined;
                const title = `${rep.label} (${leaves.length})`;
                const clusterPopMeta = {
                  detailRefreshIntervalSec: livePopupMetaRef.current.refreshIntervalSec,
                  detailRenderEpoch: livePopupMetaRef.current.renderedAt,
                };
                if (expandedRef.current) {
                  openDashboardMapMarkerPopup(map, {
                    lngLat,
                    title,
                    siteId: siteStr,
                    sourceType: "latest_device_state",
                    sourceId: sid,
                    trendScope: "endpoint",
                    kpiKeys,
                    expandedMapIntel: true,
                    ...clusterPopMeta,
                  });
                  return;
                }
                if (enterpriseModeRef.current) {
                  openDashboardMapMarkerPopup(map, {
                    lngLat,
                    title,
                    siteId: siteStr,
                    sourceType: "latest_device_state",
                    sourceId: sid,
                    trendScope: "endpoint",
                    kpiKeys,
                    expandedMapIntel: false,
                    ...clusterPopMeta,
                  });
                  return;
                }
                setInlineMarkerDetail({
                  siteId: siteStr,
                  sourceType: "latest_device_state",
                  sourceId: sid,
                  title,
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
      deckHandleRef.current.applyLayerControls(layerControlsRef.current);
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

  useEffect(() => {
    const deck = deckHandleRef.current;
    if (!deck) return;
    deck.setIntelRichSamplePick((p: RichMapPoint) => {
      markerPickTsRef.current = Date.now();
      const siteRaw = latestBlockRef.current.data?.site_id;
      const siteId = typeof siteRaw === "string" ? siteRaw : undefined;
      const ldsId = p.latestDeviceStateId;
      if (!siteId || !ldsId) return;
      const map = mapRef.current;
      if (!map) return;
      const ch = adaptMapChrome(latestBlockRef.current);
      const titleBase = p.label?.trim() || "Device";
      const title = `${titleBase} · ${p.eventTs}`;
      const popExtra = {
        kpiKeys: ch.kpiFields?.length ? ch.kpiFields : undefined,
        trendScope: ch.mapDefaultTrendScope ?? undefined,
        detailRefreshIntervalSec: livePopupMetaRef.current.refreshIntervalSec,
        detailRenderEpoch: livePopupMetaRef.current.renderedAt,
      };
      if (expandedRef.current) {
        openDashboardMapMarkerPopup(map, {
          lngLat: [p.lng, p.lat],
          title,
          siteId,
          sourceType: "latest_device_state",
          sourceId: ldsId,
          expandedMapIntel: true,
          ...popExtra,
        });
        return;
      }
      if (enterpriseModeRef.current) {
        openDashboardMapMarkerPopup(map, {
          lngLat: [p.lng, p.lat],
          title,
          siteId,
          sourceType: "latest_device_state",
          sourceId: ldsId,
          expandedMapIntel: false,
          ...popExtra,
        });
        return;
      }
      setInlineMarkerDetail({
        siteId,
        sourceType: "latest_device_state",
        sourceId: ldsId,
        title,
        kpiKeys: popExtra.kpiKeys,
        trendScope: popExtra.trendScope,
      });
    });
    return () => {
      deck.setIntelRichSamplePick(undefined);
    };
  }, [markerFetch, syncKey, expanded, enterpriseMode, block.widget_id]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => map.resize());
    });
    const delayed =
      expanded &&
      window.setTimeout(() => {
        map.resize();
      }, 120);
    return () => {
      cancelAnimationFrame(outerRaf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
      if (delayed) window.clearTimeout(delayed);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => map.resize());
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      if (innerRaf) cancelAnimationFrame(innerRaf);
    };
  }, [inlineMarkerDetail]);

  useEffect(() => {
    if (expanded) setInlineMarkerDetail(null);
  }, [expanded]);

  useEffect(() => {
    setInlineMarkerDetail(null);
  }, [block.widget_id]);

  useEffect(() => {
    if (!inlineMarkerDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInlineMarkerDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineMarkerDetail]);

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
  const intelEndpointId = dominantEndpointId(filteredMarkers);
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
    !expanded && !isEnterprise && inlineMarkerDetail ? "dash-map-widget--inline-detail" : "",
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
            <div className="dash-map-widget__expanded-main-row">
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
            <aside className="dash-map-widget__expanded-layer-col" aria-label="Map layers and legend">
              <div className="dash-map-widget__layer-tools">
                <MapLayerControlPanel value={layerControls} onChange={setLayerControls} />
                <MapLayerLegend layerControls={layerControls} markers={filteredMarkers} intelOverlay={intelOverlay} />
              </div>
            </aside>
          </div>
        ) : isEnterprise ? (
          <div className="dash-map-widget__enterprise-grid">
            <div className="dash-map-widget__map-col">{mapEl}</div>
            <EnterpriseSiteCountsPanel />
          </div>
        ) : (
          <div
            className={`dash-map-widget__inline-split ${inlineMarkerDetail ? "dash-map-widget__inline-split--open" : ""}`}
          >
            <div className="dash-map-widget__inline-split-map">
              <div className="dash-map-widget__single-map-wrap dash-map-widget__single-map-wrap--inline">
                {mapEl}
              </div>
            </div>
            <aside
              className="dash-map-widget__inline-detail"
              aria-hidden={!inlineMarkerDetail}
              aria-label={inlineMarkerDetail ? "Marker detail" : undefined}
            >
              {inlineMarkerDetail ? (
                <>
                  <div className="dash-map-widget__inline-detail-head">
                    <button
                      type="button"
                      className="dash-map-widget__inline-detail-close"
                      onClick={() => setInlineMarkerDetail(null)}
                    >
                      Close
                    </button>
                  </div>
                  <div className="dash-map-widget__inline-detail-body">
                    <MapMarkerPopupRoot
                      key={`${inlineMarkerDetail.sourceType}:${inlineMarkerDetail.sourceId}`}
                      siteId={inlineMarkerDetail.siteId}
                      sourceType={inlineMarkerDetail.sourceType}
                      sourceId={inlineMarkerDetail.sourceId}
                      title={inlineMarkerDetail.title}
                      blockedMessage={inlineMarkerDetail.blockedMessage}
                      trendScope={inlineMarkerDetail.trendScope}
                      kpiKeys={inlineMarkerDetail.kpiKeys}
                    />
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </DashboardWidgetFrame>
    </>
  );
}

