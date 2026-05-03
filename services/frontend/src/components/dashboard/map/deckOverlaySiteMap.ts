import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { IControl, Map as MaplibreMap } from "maplibre-gl";
import Supercluster from "supercluster";
import type { MapPointVM } from "@/lib/dashboard/mapViewModel";
import { healthToRgb } from "@/lib/dashboard/mapViewModel";
import type { RichMapPoint } from "@/types/mapTransport";
import {
  DEFAULT_MAP_LAYER_CONTROLS,
  type MapLayerControls,
  stableHueFromString,
} from "@/lib/dashboard/mapLayerControls";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

/** Historical footprint + gap markers (expanded map intelligence). */
export type IntelOverlayState = {
  /** Polyline for one device path (optional when only site samples are shown). */
  footprint?: [number, number][];
  gapPoints?: [number, number][];
  start?: [number, number];
  end?: [number, number];
  /** Head of vehicle during historical replay (lng, lat). */
  movingLngLat?: [number, number];
  /** Deduped scrubbed-event samples (site or endpoint) for historical mode. */
  samplePoints?: [number, number][];
  /** Full transport points for historical pick → detail (preferred over `samplePoints` alone). */
  richSamplePoints?: RichMapPoint[];
};

type PointFeat = GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>;

function markerFillRgba(vm: MapPointVM | undefined, colorMode: MapLayerControls["colorMode"]): [number, number, number, number] {
  if (!vm) return [148, 163, 184, 220];
  if (colorMode === "health") {
    return healthToRgb(vm.health_status);
  }
  if (colorMode === "group") {
    if (typeof vm.marker_hue === "number" && Number.isFinite(vm.marker_hue)) {
      const rgb = hslToRgb(vm.marker_hue / 360, 0.72, 0.5);
      return [...rgb, 232];
    }
    return healthToRgb(vm.health_status);
  }
  const key = (vm.device_id && String(vm.device_id).trim()) || vm.source_id || vm.id || "x";
  const h = stableHueFromString(key);
  const rgb = hslToRgb(h / 360, 0.68, 0.52);
  return [...rgb, 232];
}

function toFeatures(points: MapPointVM[]): PointFeat[] {
  return points.map((p) => ({
    type: "Feature",
    properties: {
      id: p.id,
      label: p.label,
      health_status: p.health_status,
      source_type: p.source_type,
      source_id: p.source_id,
      cluster: false,
      vm: p,
    },
    geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
  }));
}

function buildClusterData(index: Supercluster, map: MaplibreMap): PointFeat[] {
  const b = map.getBounds();
  const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const z = Math.max(0, Math.floor(map.getZoom()));
  return index.getClusters(bbox, z) as PointFeat[];
}

export type DeckSiteMapHandle = {
  updatePoints: (points: MapPointVM[], useCluster: boolean) => void;
  setIntelligenceOverlay: (state: IntelOverlayState | null) => void;
  setIntelRichSamplePick: (handler: ((p: RichMapPoint) => void) | undefined) => void;
  applyLayerControls: (next: MapLayerControls) => void;
  getClusterExpansionZoom: (clusterId: number) => number;
  /** Supercluster leaves for a cluster id (empty if not in cluster mode). */
  getClusterLeaves: (clusterId: number) => MapPointVM[];
  dispose: () => void;
};

/**
 * MapLibre basemap + deck.gl ScatterplotLayer (clusters + points) + optional fleet heading paths.
 * Map instance is not recreated on data refresh — only deck layers update.
 */
export function attachDeckSiteMapOverlay(
  map: MaplibreMap,
  options: {
    profile: "site" | "fleet";
    onPointPick: (vm: MapPointVM, lngLat: [number, number]) => void;
    onClusterPick: (clusterId: number, lngLat: [number, number], expansionZoom: number) => void;
    initialLayerControls?: MapLayerControls;
    onIntelRichSamplePick?: (p: RichMapPoint) => void;
  },
): DeckSiteMapHandle {
  const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay as unknown as IControl);

  const intelRichPickHandlers: { onPick?: (p: RichMapPoint) => void } = {
    onPick: options.onIntelRichSamplePick,
  };

  let lastPoints: MapPointVM[] = [];
  let intelOverlay: IntelOverlayState | null = null;
  let layerControls: MapLayerControls = {
    ...DEFAULT_MAP_LAYER_CONTROLS,
    ...(options.initialLayerControls ?? {}),
  };

  let index: Supercluster | null = null;
  let useClusterMode = true;
  let cached: PointFeat[] = [];

  const refresh = () => {
    const layers: unknown[] = [];
    const data: PointFeat[] =
      useClusterMode && index
        ? buildClusterData(index, map)
        : cached;

    layers.push(
      new ScatterplotLayer({
        id: "dash-scatter-main",
        data,
        pickable: true,
        radiusUnits: "pixels",
        getPosition: (d: PointFeat) => d.geometry.coordinates as [number, number],
        getRadius: (d: PointFeat) => {
          const p = d.properties;
          if (p?.cluster) {
            const n = Number(p.point_count ?? 1);
            return Math.min(34, 16 + Math.min(18, Math.log2(n + 1) * 5));
          }
          return 10;
        },
        getFillColor: (d: PointFeat) => {
          const p = d.properties;
          if (p?.cluster) return [79, 70, 229, 235];
          const vm = p?.vm as MapPointVM | undefined;
          return markerFillRgba(vm, layerControls.colorMode);
        },
        getLineColor: [255, 255, 255, 220],
        lineWidthMinPixels: 2,
        stroked: true,
        filled: true,
        onClick: (info) => {
          const o = info.object as PointFeat | undefined;
          if (!o?.properties) return;
          const p = o.properties;
          const coords = o.geometry.coordinates as [number, number];
          if (p.cluster === true || p.cluster === 1) {
            const cid = Number(p.cluster_id);
            const z = index?.getClusterExpansionZoom(cid) ?? map.getZoom() + 2;
            options.onClusterPick(cid, coords, z);
          } else {
            options.onPointPick(p.vm as MapPointVM, coords);
          }
        },
      }),
    );

    const headingPaths: Array<{ path: [number, number][] }> = [];
    for (const pt of lastPoints) {
      const h = pt.heading_deg;
      if (h == null || Number.isNaN(h)) continue;
      if (options.profile !== "fleet" && pt.mobility_type !== "dynamic") continue;
      const rad = (h * Math.PI) / 180;
      const len = 0.0025;
      const x = pt.longitude + len * Math.sin(rad);
      const y = pt.latitude + len * Math.cos(rad);
      headingPaths.push({ path: [[pt.longitude, pt.latitude], [x, y]] });
    }
    if (headingPaths.length) {
      layers.push(
        new PathLayer({
          id: "dash-fleet-heading",
          data: headingPaths,
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [250, 204, 21, 200],
          getWidth: 3,
          widthUnits: "pixels",
          pickable: false,
        }),
      );
    }

    if (
      layerControls.showHistoricalPath &&
      intelOverlay?.footprint &&
      intelOverlay.footprint.length >= 2
    ) {
      layers.push(
        new PathLayer({
          id: "dash-intel-footprint",
          data: [{ path: intelOverlay.footprint }],
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [59, 130, 246, 220],
          getWidth: 4,
          widthUnits: "pixels",
          pickable: false,
        }),
      );
    }
    if (layerControls.showGapPoints && intelOverlay?.gapPoints?.length) {
      layers.push(
        new ScatterplotLayer({
          id: "dash-intel-gaps",
          data: intelOverlay.gapPoints.map((p) => ({ position: p as [number, number] })),
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: 7,
          radiusUnits: "pixels",
          getFillColor: [251, 146, 60, 230],
          stroked: true,
          getLineColor: [255, 255, 255, 180],
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }
    const anchorPts: { position: [number, number]; fill: [number, number, number, number] }[] = [];
    if (layerControls.showStartEndAnchors && intelOverlay?.start) {
      anchorPts.push({ position: intelOverlay.start, fill: [34, 197, 94, 240] });
    }
    if (layerControls.showStartEndAnchors && intelOverlay?.end) {
      anchorPts.push({ position: intelOverlay.end, fill: [239, 68, 68, 240] });
    }
    if (anchorPts.length) {
      layers.push(
        new ScatterplotLayer({
          id: "dash-intel-ab",
          data: anchorPts,
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: 10,
          radiusUnits: "pixels",
          getFillColor: (d: { fill: [number, number, number, number] }) => d.fill,
          stroked: true,
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 2,
          pickable: false,
        }),
      );
    }
    if (layerControls.showReplayHead && intelOverlay?.movingLngLat) {
      layers.push(
        new ScatterplotLayer({
          id: "dash-intel-moving",
          data: [{ position: intelOverlay.movingLngLat as [number, number] }],
          getPosition: (row: { position: [number, number] }) => row.position,
          getRadius: 14,
          radiusUnits: "pixels",
          getFillColor: [250, 204, 21, 240],
          stroked: true,
          getLineColor: [255, 255, 255, 230],
          lineWidthMinPixels: 2,
          pickable: false,
        }),
      );
    }

    if (intelOverlay?.richSamplePoints?.length) {
      layers.push(
        new ScatterplotLayer({
          id: "dash-intel-hist-samples",
          data: intelOverlay.richSamplePoints.map((r) => ({
            position: [r.lng, r.lat] as [number, number],
            rich: r,
          })),
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: 8,
          radiusUnits: "pixels",
          getFillColor: [96, 165, 250, 210],
          stroked: true,
          getLineColor: [15, 23, 42, 160],
          lineWidthMinPixels: 1,
          pickable: Boolean(intelRichPickHandlers.onPick),
          onClick: (info) => {
            const row = info.object as { rich?: RichMapPoint } | undefined;
            if (row?.rich) intelRichPickHandlers.onPick?.(row.rich);
          },
        }),
      );
    } else if (intelOverlay?.samplePoints?.length) {
      layers.push(
        new ScatterplotLayer({
          id: "dash-intel-hist-samples",
          data: intelOverlay.samplePoints.map((p) => ({ position: p as [number, number] })),
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: 6,
          radiusUnits: "pixels",
          getFillColor: [96, 165, 250, 210],
          stroked: true,
          getLineColor: [15, 23, 42, 160],
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }

    if (layerControls.showLabels && lastPoints.length) {
      const labelRows = lastPoints.map((p) => ({
        position: [p.longitude, p.latitude] as [number, number],
        text: p.label?.trim() ? String(p.label).slice(0, 40) : "·",
      }));
      layers.push(
        new TextLayer({
          id: "dash-marker-labels",
          data: labelRows,
          getPosition: (d: { position: [number, number] }) => d.position,
          getText: (d: { text: string }) => d.text,
          getSize: 11,
          sizeUnits: "pixels",
          getColor: [250, 250, 250, 240],
          getBackgroundColor: [15, 23, 42, 200],
          background: true,
          backgroundPadding: [3, 1] as [number, number],
          getPixelOffset: [0, -16] as [number, number],
          billboard: true,
          pickable: false,
        }),
      );
    }

    overlay.setProps({ layers: layers as never[] });
  };

  const onMove = () => window.requestAnimationFrame(refresh);
  map.on("moveend", onMove);
  map.on("zoomend", onMove);

  const updatePoints = (points: MapPointVM[], useCluster: boolean) => {
    lastPoints = points;
    useClusterMode = useCluster;
    const feats = toFeatures(points);
    cached = feats;
    if (useCluster) {
      index = new Supercluster({ radius: 52, maxZoom: 14 });
      index.load(feats as never);
    } else {
      index = null;
    }
    refresh();
  };

  return {
    updatePoints,
    applyLayerControls: (next: MapLayerControls) => {
      layerControls = { ...DEFAULT_MAP_LAYER_CONTROLS, ...next };
      refresh();
    },
    setIntelRichSamplePick: (handler) => {
      intelRichPickHandlers.onPick = handler;
      refresh();
    },
    setIntelligenceOverlay: (state: IntelOverlayState | null) => {
      intelOverlay = state;
      refresh();
    },
    getClusterExpansionZoom: (clusterId: number) => index?.getClusterExpansionZoom(clusterId) ?? map.getZoom() + 2,
    getClusterLeaves: (clusterId: number): MapPointVM[] => {
      if (!index) return [];
      try {
        const feats = index.getLeaves(clusterId, Infinity) as PointFeat[];
        return feats
          .map((f) => f.properties?.vm as MapPointVM | undefined)
          .filter((vm): vm is MapPointVM => Boolean(vm));
      } catch {
        return [];
      }
    },
    dispose: () => {
      map.off("moveend", onMove);
      map.off("zoomend", onMove);
      try {
        overlay.finalize();
      } catch {
        /* noop */
      }
    },
  };
}
