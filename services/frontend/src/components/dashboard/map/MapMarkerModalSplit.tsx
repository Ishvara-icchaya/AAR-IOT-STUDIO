import { useLayoutEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ReactNode } from "react";
import type { LngLatLike, StyleSpecification } from "maplibre-gl";
import { OFFLINE_FALLBACK_MAP_STYLE } from "@/lib/dashboardMapStyle";

export function normalizeLngLatLike(ll: LngLatLike | undefined): [number, number] | null {
  if (ll == null) return null;
  if (Array.isArray(ll)) {
    const a = Number(ll[0]);
    const b = Number(ll[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [a, b];
  }
  if (typeof ll === "object" && "lng" in ll && "lat" in ll) {
    const a = Number((ll as { lng: unknown }).lng);
    const b = Number((ll as { lat: unknown }).lat);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [a, b];
  }
  return null;
}

function lngLatTuple(center: [number, number]): [number, number] {
  return [center[0], center[1]];
}

function MapMarkerModalPreviewMap({
  center,
  mapStyleUrl,
}: {
  center: [number, number];
  mapStyleUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ll = lngLatTuple(center);
    let styleFallback = false;
    const map = new maplibregl.Map({
      container,
      style: mapStyleUrl,
      center: ll,
      zoom: 13,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    map.on("error", () => {
      if (styleFallback) return;
      styleFallback = true;
      try {
        map.setStyle(OFFLINE_FALLBACK_MAP_STYLE as unknown as StyleSpecification);
      } catch {
        /* noop */
      }
    });

    markerRef.current = new maplibregl.Marker({ color: "#3b82f6" }).setLngLat(ll).addTo(map);

    let resizeRaf: number | null = null;
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.round(cr.width);
      const h = Math.round(cr.height);
      if (w > 0 && h > 0 && Math.abs(w - lastW) < 4 && Math.abs(h - lastH) < 4) return;
      lastW = w;
      lastH = h;
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        try {
          map.resize();
        } catch {
          /* tearing down */
        }
      });
    });
    ro.observe(container);

    const onLoad = () => {
      try {
        map.jumpTo({ center: ll, zoom: Math.max(map.getZoom(), 12) });
      } catch {
        /* noop */
      }
    };
    if (map.isStyleLoaded()) onLoad();
    else map.once("load", onLoad);

    return () => {
      if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
    };
  }, [center[0], center[1], mapStyleUrl]);

  return <div ref={containerRef} className="dash-map-marker-modal__map-canvas" />;
}

export function MapMarkerModalSplit({
  detail,
  mapCenter,
  mapStyleUrl,
}: {
  detail: ReactNode;
  mapCenter: [number, number] | null;
  mapStyleUrl: string;
}) {
  if (!mapCenter) {
    return <div className="dash-map-marker-modal__detail-only">{detail}</div>;
  }

  return (
    <div className="dash-map-marker-modal__split">
      <div className="dash-map-marker-modal__col dash-map-marker-modal__col--detail">{detail}</div>
      <aside className="dash-map-marker-modal__col dash-map-marker-modal__col--map" aria-label="Device location on map">
        <div className="dash-map-marker-modal__map-heading">Map</div>
        <MapMarkerModalPreviewMap center={mapCenter} mapStyleUrl={mapStyleUrl} />
      </aside>
    </div>
  );
}
