import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { IControl, Map as MaplibreMap } from "maplibre-gl";
import Supercluster from "supercluster";
import type { MapPointVM } from "@/lib/dashboard/mapViewModel";
import { healthToRgb } from "@/lib/dashboard/mapViewModel";

type PointFeat = GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>;

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
  },
): DeckSiteMapHandle {
  const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay as unknown as IControl);

  let lastPoints: MapPointVM[] = [];

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
          return healthToRgb(vm?.health_status ?? (p?.health_status as string));
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

    if (options.profile === "fleet") {
      const pts = lastPoints;
      const paths: Array<{ path: [number, number][]; vm: MapPointVM }> = [];
      for (const pt of pts) {
        const h = pt.heading_deg;
        if (h == null || Number.isNaN(h)) continue;
        const rad = (h * Math.PI) / 180;
        const len = 0.0025;
        const x = pt.longitude + len * Math.sin(rad);
        const y = pt.latitude + len * Math.cos(rad);
        paths.push({ path: [[pt.longitude, pt.latitude], [x, y]], vm: pt });
      }
      if (paths.length) {
        layers.push(
          new PathLayer({
            id: "dash-fleet-heading",
            data: paths,
            getPath: (d: { path: [number, number][] }) => d.path,
            getColor: [250, 204, 21, 200],
            getWidth: 3,
            widthUnits: "pixels",
            pickable: false,
          }),
        );
      }
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
