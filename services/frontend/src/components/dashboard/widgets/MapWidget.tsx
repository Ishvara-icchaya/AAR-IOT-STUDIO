import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DashboardLiveWidgetDTO, EnterpriseSiteObjectCountsDTO } from "@/types/dashboard";
import { useDashboardLiveRuntime } from "@/components/dashboard/DashboardLiveContext";
import { OFFLINE_FALLBACK_MAP_STYLE } from "@/lib/dashboardMapStyle";
import { getEnterpriseSiteObjectCounts, getMapObjectDetail } from "@/api/dashboard";

const SOURCE_ID = "dash-map-geojson";
const CLUSTER_LAYER_ID = "dash-map-clusters";
const CLUSTER_COUNT_ID = "dash-map-cluster-count";
const UNCLUSTERED_LAYER_ID = "dash-map-unclustered";

type MarkerRec = {
  latitude: number;
  longitude: number;
  display_name?: string;
  device_name?: string;
  site_name?: string;
  kpis?: Record<string, unknown>;
  health_status?: string;
  health_message?: string;
  blink_mode?: string;
  updated_at?: string;
  source_type?: string;
  source_id?: string;
};

type MapInit = {
  center?: [number, number];
  zoom?: number;
  bounds?: [[number, number], [number, number]];
};

type MapControls = {
  auto_fit_on_first_load?: boolean;
  auto_fit_on_refresh?: boolean;
  preserve_viewport?: boolean;
  cluster_markers?: boolean;
  max_direct_markers?: number;
};

function readControls(d: Record<string, unknown>): MapControls {
  const c = (d.map_controls as MapControls) || {};
  const mx = c.max_direct_markers;
  return {
    auto_fit_on_first_load: c.auto_fit_on_first_load !== false,
    auto_fit_on_refresh: c.auto_fit_on_refresh === true,
    preserve_viewport: c.preserve_viewport !== false,
    cluster_markers: c.cluster_markers !== false,
    max_direct_markers: typeof mx === "number" && Number.isFinite(mx) ? mx : 80,
  };
}

function readMapInit(d: Record<string, unknown>): MapInit | undefined {
  const m = d.map_init;
  if (!m || typeof m !== "object") return undefined;
  const o = m as Record<string, unknown>;
  const center = o.center;
  const bounds = o.bounds;
  const zoom = o.zoom;
  let c: [number, number] | undefined;
  if (Array.isArray(center) && center.length >= 2 && typeof center[0] === "number" && typeof center[1] === "number") {
    c = [center[0], center[1]];
  }
  let b: [[number, number], [number, number]] | undefined;
  if (
    Array.isArray(bounds) &&
    bounds.length === 2 &&
    Array.isArray(bounds[0]) &&
    Array.isArray(bounds[1])
  ) {
    const a0 = bounds[0] as unknown[];
    const a1 = bounds[1] as unknown[];
    if (
      a0.length >= 2 &&
      a1.length >= 2 &&
      typeof a0[0] === "number" &&
      typeof a0[1] === "number" &&
      typeof a1[0] === "number" &&
      typeof a1[1] === "number"
    ) {
      b = [
        [a0[0], a0[1]],
        [a1[0], a1[1]],
      ];
    }
  }
  const z = typeof zoom === "number" && Number.isFinite(zoom) ? zoom : undefined;
  if (!c && !b) return undefined;
  return { center: c, zoom: z, bounds: b };
}

function markerListFromData(d: Record<string, unknown>, title: string): MarkerRec[] {
  const mode = String(d.mode ?? "single");
  const list: MarkerRec[] = [];
  if (mode === "multi" && Array.isArray(d.markers)) {
    for (const raw of d.markers) {
      if (!raw || typeof raw !== "object") continue;
      const m = raw as MarkerRec;
      if (typeof m.latitude === "number" && typeof m.longitude === "number") list.push({ ...m });
    }
    return list;
  }
  if (typeof d.latitude === "number" && typeof d.longitude === "number") {
    list.push({
      latitude: d.latitude,
      longitude: d.longitude,
      display_name: String(d.display_name ?? title),
      health_status: d.health_status as string | undefined,
      blink_mode: d.blink_mode as string | undefined,
      updated_at: d.updated_at as string | undefined,
      source_type: typeof d.source_type === "string" ? d.source_type : undefined,
      source_id: typeof d.source_id === "string" ? d.source_id : undefined,
    });
  }
  return list;
}

function useClusterEffective(list: MarkerRec[], controls: MapControls): boolean {
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

function dataSyncKey(d: Record<string, unknown>, list: MarkerRec[], controls: MapControls): string {
  const cluster = useClusterEffective(list, controls) ? "1" : "0";
  const mc = JSON.stringify(d.map_controls ?? {});
  return `${markersFingerprint(list)}|${cluster}|${mc}`;
}

function buildGeoJSON(list: MarkerRec[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: list.map((m) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [m.longitude, m.latitude] },
      properties: {
        display_name: m.display_name ?? "",
        health_status: (m.health_status ?? "").toLowerCase(),
        source_type: m.source_type ?? "",
        source_id: m.source_id ?? "",
      },
    })),
  };
}

const HEALTH_MATCH: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "health_status"],
  "green",
  "#22c55e",
  "yellow",
  "#eab308",
  "red",
  "#ef4444",
  "offline",
  "#64748b",
  "#94a3b8",
];

function removePointLayers(map: maplibregl.Map) {
  for (const id of [CLUSTER_COUNT_ID, CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

function attachMapInteractions(
  map: maplibregl.Map,
  useCluster: boolean,
  getSiteId: () => string | undefined,
) {
  const onClusterClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f?.properties?.cluster_id) return;
    const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!src || typeof src.getClusterExpansionZoom !== "function") return;
    const clusterId = Number(f.properties.cluster_id);
    if (!Number.isFinite(clusterId)) return;
    const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    void (async () => {
      try {
        const zoom = await src.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: coords, zoom: Math.max(zoom, map.getZoom() + 1) });
      } catch {
        map.easeTo({ center: coords, zoom: map.getZoom() + 2 });
      }
    })();
  };

  const onPointClick = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f?.properties) return;
    const props = f.properties as Record<string, string>;
    const lngLat = e.lngLat;
    const siteId = getSiteId();
    const st = props.source_type;
    const sid = props.source_id;
    const displayName = props.display_name || "Object";

    const popup = new maplibregl.Popup({
      offset: 18,
      maxWidth: "380px",
      className: "dash-map-popup-shell",
      closeButton: true,
      closeOnClick: false,
    })
      .setLngLat(lngLat)
      .addTo(map);
    popup.setHTML(popupContentMinimal(displayName));

    if (!siteId || !st || !sid) {
      popup.setHTML(popupContentNoDetail(displayName, "No detail link (missing site or source)."));
      return;
    }

    void (async () => {
      try {
        const r = await getMapObjectDetail({
          siteId,
          sourceType: String(st),
          sourceId: String(sid),
        });
        if (r?.detail && typeof r.detail === "object") {
          popup.setHTML(popupContentFromDetail(displayName, r.detail as Record<string, unknown>));
        } else {
          popup.setHTML(popupContentMinimal(displayName));
        }
      } catch {
        popup.setHTML(popupContentMinimal(displayName));
      }
    })();
  };

  if (useCluster) {
    map.on("click", CLUSTER_LAYER_ID, onClusterClick);
  }
  map.on("click", UNCLUSTERED_LAYER_ID, onPointClick);

  const cursorIn = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const cursorOut = () => {
    map.getCanvas().style.cursor = "";
  };
  if (useCluster) {
    map.on("mouseenter", CLUSTER_LAYER_ID, cursorIn);
    map.on("mouseleave", CLUSTER_LAYER_ID, cursorOut);
  }
  map.on("mouseenter", UNCLUSTERED_LAYER_ID, cursorIn);
  map.on("mouseleave", UNCLUSTERED_LAYER_ID, cursorOut);

  return () => {
    if (useCluster) {
      map.off("click", CLUSTER_LAYER_ID, onClusterClick);
      map.off("mouseenter", CLUSTER_LAYER_ID, cursorIn);
      map.off("mouseleave", CLUSTER_LAYER_ID, cursorOut);
    }
    map.off("click", UNCLUSTERED_LAYER_ID, onPointClick);
    map.off("mouseenter", UNCLUSTERED_LAYER_ID, cursorIn);
    map.off("mouseleave", UNCLUSTERED_LAYER_ID, cursorOut);
  };
}

function addPointLayers(map: maplibregl.Map, useCluster: boolean) {
  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: useCluster,
    clusterMaxZoom: 14,
    clusterRadius: 52,
  });

  if (useCluster) {
    map.addLayer({
      id: CLUSTER_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#4f46e5",
        "circle-radius": ["step", ["get", "point_count"], 20, 12, 24, 40, 30, 100, 34],
        "circle-opacity": 0.92,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "rgba(255,255,255,0.98)",
      },
    });
    map.addLayer({
      id: CLUSTER_COUNT_ID,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 13,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(0,0,0,0.25)",
        "text-halo-width": 0.8,
      },
    });
  }

  const unclusteredFilter: maplibregl.ExpressionSpecification | undefined = useCluster
    ? ["!", ["has", "point_count"]]
    : undefined;

  map.addLayer({
    id: UNCLUSTERED_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    ...(unclusteredFilter ? { filter: unclusteredFilter } : {}),
    paint: {
      "circle-color": HEALTH_MATCH,
      "circle-radius": 10,
      "circle-stroke-width": 2.5,
      "circle-stroke-color": "rgba(255,255,255,0.98)",
      "circle-opacity": 0.95,
    },
  });
}

function applyViewport(
  map: maplibregl.Map,
  list: MarkerRec[],
  init: MapInit | undefined,
  controls: MapControls,
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
        map.jumpTo({ center: [list[0].longitude, list[0].latitude], zoom: 12 });
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
  const { mapStyleUrl, enterpriseMode } = useDashboardLiveRuntime();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latestBlockRef = useRef(block);
  latestBlockRef.current = block;

  const firstFitDoneRef = useRef(false);
  const lastClusterRef = useRef<boolean | null>(null);
  const detachInteractionsRef = useRef<(() => void) | null>(null);

  const d = block.data ?? {};
  const [styleNotice, setStyleNotice] = useState<string | null>(null);

  const markerList = useMemo(() => markerListFromData(block.data ?? {}, block.title), [block.data, block.title]);
  const controls = useMemo(() => readControls(block.data ?? {}), [block.data]);
  const syncKey = useMemo(
    () => dataSyncKey(block.data ?? {}, markerList, controls),
    [block.data, markerList, controls],
  );

  useEffect(() => {
    firstFitDoneRef.current = false;
    lastClusterRef.current = null;
  }, [block.widget_id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let styleFallbackUsed = false;
    const init = readMapInit(latestBlockRef.current.data ?? {});
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
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

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
      detachInteractionsRef.current?.();
      detachInteractionsRef.current = null;
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
      const data = b.data ?? {};
      const list = markerListFromData(data, b.title);
      const ctrl = readControls(data);
      const init = readMapInit(data);
      const useCluster = useClusterEffective(list, ctrl);
      const geo = buildGeoJSON(list);

      if (lastClusterRef.current === null || lastClusterRef.current !== useCluster) {
        detachInteractionsRef.current?.();
        detachInteractionsRef.current = null;
        removePointLayers(map);
        addPointLayers(map, useCluster);
        const siteId = typeof data.site_id === "string" ? data.site_id : undefined;
        detachInteractionsRef.current = attachMapInteractions(map, useCluster, () => siteId);
        lastClusterRef.current = useCluster;
      }

      const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (src) src.setData(geo);

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
  }, [syncKey, mapStyleUrl, block.widget_id]);

  if (d.error) {
    return (
      <div className="dash-widget">
        <h3 className="dash-widget__title">{block.title}</h3>
        <p style={{ color: "#f66" }}>{String(d.error)}</p>
      </div>
    );
  }

  const isEnterprise = enterpriseMode === true;

  const mapEl = (
    <div
      ref={containerRef}
      className="dash-map-widget__map"
      style={
        isEnterprise
          ? {
              height: "100%",
              minHeight: 360,
              width: "100%",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              flex: "1 1 auto",
            }
          : {
              height: 380,
              width: "100%",
              borderRadius: "var(--radius)",
              overflow: "hidden",
            }
      }
    />
  );

  return (
    <div className={`dash-widget dash-widget--map${isEnterprise ? " dash-map-widget--enterprise" : ""}`}>
      <h3 className="dash-widget__title">{block.title}</h3>
      {styleNotice && (
        <p className="dash-widget__muted" style={{ fontSize: "0.8rem", marginBottom: "0.35rem" }}>
          {styleNotice}
        </p>
      )}
      {isEnterprise ? (
        <div className="dash-map-widget__enterprise-grid">
          <div className="dash-map-widget__map-col">{mapEl}</div>
          <EnterpriseSiteCountsPanel />
        </div>
      ) : (
        mapEl
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function healthBadgeClass(status: string | undefined): string {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "green") return "dash-map-popup__badge dash-map-popup__badge--green";
  if (s === "yellow") return "dash-map-popup__badge dash-map-popup__badge--yellow";
  if (s === "red") return "dash-map-popup__badge dash-map-popup__badge--red";
  if (s === "offline") return "dash-map-popup__badge dash-map-popup__badge--offline";
  return "dash-map-popup__badge dash-map-popup__badge--neutral";
}

function kvTable(rows: Array<[string, string]>): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  return `<table class="dash-map-popup__table"><tbody>${body}</tbody></table>`;
}

function popupContentMinimal(title: string): string {
  return `<div class="dash-map-popup">
  <div class="dash-map-popup__loading">
    <div class="dash-map-popup__head">
      <span class="dash-map-popup__title">${escapeHtml(title)}</span>
    </div>
    <p class="dash-map-popup__hint">Loading asset details…</p>
  </div>
</div>`;
}

function popupContentNoDetail(title: string, message: string): string {
  return `<div class="dash-map-popup dash-map-popup--bare">
  <div class="dash-map-popup__head">
    <span class="dash-map-popup__title">${escapeHtml(title)}</span>
  </div>
  <p class="dash-map-popup__msg">${escapeHtml(message)}</p>
</div>`;
}

function popupContentFromDetail(title: string, detail: Record<string, unknown>): string {
  const h = (detail.health as Record<string, unknown> | undefined) || {};
  const kl = (detail.kpi_latest as Record<string, unknown> | undefined) || {};
  const df = (detail.display_fields as Record<string, unknown> | undefined) || {};
  const win = (detail.kpi_windows_redis as Record<string, unknown> | undefined) || {};
  const hs = h.health_status as string | undefined;
  const badge = hs ? `<span class="${healthBadgeClass(hs)}">${escapeHtml(hs)}</span>` : "";
  const parts: string[] = [];
  parts.push('<div class="dash-map-popup">');
  parts.push('<div class="dash-map-popup__head">');
  parts.push(`<span class="dash-map-popup__title">${escapeHtml(title)}</span>`);
  if (badge) parts.push(badge);
  parts.push("</div>");
  const hm = h.health_message as string | undefined;
  if (hm) parts.push(`<p class="dash-map-popup__msg">${escapeHtml(hm)}</p>`);

  const displayRows: Array<[string, string]> = Object.entries(df)
    .slice(0, 12)
    .map(([k, v]) => [k, String(v ?? "—")]);
  if (displayRows.length) {
    parts.push('<div class="dash-map-popup__section">');
    parts.push('<div class="dash-map-popup__section-title">Display</div>');
    parts.push(kvTable(displayRows));
    parts.push("</div>");
  }

  const kpiRows: Array<[string, string]> = Object.entries(kl)
    .slice(0, 12)
    .map(([k, v]) => [k, String(v ?? "—")]);
  if (kpiRows.length) {
    parts.push('<div class="dash-map-popup__section">');
    parts.push('<div class="dash-map-popup__section-title">KPI (latest)</div>');
    parts.push(kvTable(kpiRows));
    parts.push("</div>");
  }

  const w1h = win["1h"] as Record<string, unknown> | undefined;
  const w24 = win["24h"] as Record<string, unknown> | undefined;
  if (w1h && Object.keys(w1h).length) {
    const rows: Array<[string, string]> = Object.entries(w1h)
      .slice(0, 6)
      .map(([k, arr]) => [k, JSON.stringify(arr).slice(0, 140)]);
    parts.push('<div class="dash-map-popup__section dash-map-popup__section--compact">');
    parts.push('<div class="dash-map-popup__section-title">Redis · 1h</div>');
    parts.push(kvTable(rows));
    parts.push("</div>");
  }
  if (w24 && Object.keys(w24).length) {
    const rows: Array<[string, string]> = Object.entries(w24)
      .slice(0, 6)
      .map(([k, arr]) => [k, JSON.stringify(arr).slice(0, 140)]);
    parts.push('<div class="dash-map-popup__section dash-map-popup__section--compact">');
    parts.push('<div class="dash-map-popup__section-title">Redis · 24h</div>');
    parts.push(kvTable(rows));
    parts.push("</div>");
  }

  parts.push('<p class="dash-map-popup__footer">Runtime detail</p>');
  parts.push("</div>");
  return parts.join("");
}
