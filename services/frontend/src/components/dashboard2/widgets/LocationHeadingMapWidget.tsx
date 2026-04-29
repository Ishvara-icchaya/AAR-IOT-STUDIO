import { useEffect, useMemo, useRef } from "react";
import maplibregl, { type LngLatBoundsLike, type Marker } from "maplibre-gl";
import type { ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";
import "maplibre-gl/dist/maplibre-gl.css";

export type LocationHeadingMapWidgetConfig = {
  showClusters?: boolean;
  showHeading?: boolean;
  showLabels?: boolean;
  showTrails?: boolean;
  animateMovement?: boolean;
  autoFitBounds?: boolean;
  markerColorMode?: "health_status" | "lifecycle_status" | "device_type";
  refreshIntervalSec?: number;
  defaultZoom?: number;
  mapStyleUrl?: string;
};

export const DEFAULT_LOCATION_HEADING_MAP_CONFIG: Required<LocationHeadingMapWidgetConfig> = {
  showClusters: true,
  showHeading: true,
  showLabels: false,
  showTrails: false,
  animateMovement: true,
  autoFitBounds: true,
  markerColorMode: "health_status",
  refreshIntervalSec: 5,
  defaultZoom: 12,
  mapStyleUrl: "https://demotiles.maplibre.org/style.json",
};

function markerColor(health: string | null | undefined, lifecycle: string | null | undefined): string {
  const h = String(health ?? "").toLowerCase();
  if (h === "healthy") return "#22c55e";
  if (h === "warning") return "#f59e0b";
  if (h === "critical") return "#ef4444";
  const l = String(lifecycle ?? "").toLowerCase();
  if (l === "offline") return "#9ca3af";
  if (l === "error") return "#a855f7";
  return "#60a5fa";
}

function toPoint(item: ResolvedDeviceCollectionRuntimeResponse["items"][number]) {
  const lat = Number((item.location_json as Record<string, unknown> | null)?.lat ?? NaN);
  const lon = Number((item.location_json as Record<string, unknown> | null)?.lon ?? NaN);
  const heading = Number((item.location_json as Record<string, unknown> | null)?.heading ?? 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, heading, item };
}

export function LocationHeadingMapWidget({
  widget,
  data,
  mode,
}: {
  widget: DashboardWidgetInstance2;
  data: unknown;
  mode: "designer" | "preview" | "live";
}) {
  const collection = data as ResolvedDeviceCollectionRuntimeResponse | null;
  const cfg = { ...DEFAULT_LOCATION_HEADING_MAP_CONFIG, ...(widget.config as LocationHeadingMapWidgetConfig) };
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Record<string, Marker>>({});
  const didFitRef = useRef(false);

  const points = useMemo(
    () => (collection?.items ?? []).map(toPoint).filter(Boolean) as NonNullable<ReturnType<typeof toPoint>>[],
    [collection],
  );

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: cfg.mapStyleUrl,
      center: [0, 0],
      zoom: cfg.defaultZoom,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    mapRef.current = map;
    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, [cfg.defaultZoom, cfg.mapStyleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeIds = new Set<string>();
    points.forEach((p) => {
      const id = p.item.resolved_device_id;
      activeIds.add(id);
      const existing = markersRef.current[id];
      const color = markerColor(p.item.health_status, p.item.lifecycle_status);
      if (!existing) {
        const el = document.createElement("div");
        el.className = "dashboard2-map-marker";
        el.style.background = color;
        el.style.transform = cfg.showHeading ? `rotate(${p.heading}deg)` : "";
        const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
        marker.setPopup(
          new maplibregl.Popup({ offset: 12 }).setHTML(
            `<strong>${p.item.device_label ?? p.item.resolved_device_id}</strong><br/>` +
              `Type: ${p.item.device_type ?? "—"}<br/>` +
              `Lifecycle: ${p.item.lifecycle_status}<br/>` +
              `Health: ${p.item.health_status ?? "unknown"}`,
          ),
        );
        markersRef.current[id] = marker;
      } else {
        existing.setLngLat([p.lon, p.lat]);
        const el = existing.getElement();
        el.style.background = color;
        el.style.transform = cfg.showHeading ? `rotate(${p.heading}deg)` : "";
      }
    });

    Object.entries(markersRef.current).forEach(([id, marker]) => {
      if (!activeIds.has(id)) {
        marker.remove();
        delete markersRef.current[id];
      }
    });

    if (cfg.autoFitBounds && points.length > 0 && !didFitRef.current) {
      const bounds = points.reduce(
        (acc, p) => acc.extend([p.lon, p.lat]),
        new maplibregl.LngLatBounds([points[0].lon, points[0].lat], [points[0].lon, points[0].lat]),
      );
      map.fitBounds(bounds.toArray() as LngLatBoundsLike, { padding: 24, maxZoom: 14 });
      didFitRef.current = true;
    }
  }, [cfg.autoFitBounds, cfg.showHeading, points]);

  return (
    <div className="dashboard2-map-widget">
      <div className="dashboard2-map-widget__meta">
        <span>{mode.toUpperCase()}</span>
        <span>Devices: {points.length}</span>
      </div>
      <div ref={mapNode} className="dashboard2-map-widget__canvas" />
    </div>
  );
}
