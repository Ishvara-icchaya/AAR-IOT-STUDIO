import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { useDashboardLiveRuntime } from "@/components/dashboard/DashboardLiveContext";
import { blinkModeClass, healthColorVar } from "@/lib/healthBlink";
import { OFFLINE_FALLBACK_MAP_STYLE } from "@/lib/dashboardMapStyle";

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
};

export function MapWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const { mapStyleUrl } = useDashboardLiveRuntime();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const d = block.data ?? {};
  const mode = String(d.mode ?? "single");
  const [styleNotice, setStyleNotice] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    mapRef.current?.remove();
    mapRef.current = null;
    setStyleNotice(null);

    const list: MarkerRec[] = [];
    if (mode === "multi" && Array.isArray(d.markers)) {
      for (const m of d.markers as MarkerRec[]) {
        if (typeof m.latitude === "number" && typeof m.longitude === "number") list.push(m);
      }
    } else if (typeof d.latitude === "number" && typeof d.longitude === "number") {
      list.push({
        latitude: d.latitude,
        longitude: d.longitude,
        display_name: String(d.display_name ?? block.title),
        kpis: (d.kpis as Record<string, unknown>) || {},
        health_status: d.health_status as string | undefined,
        health_message: d.health_message as string | undefined,
        blink_mode: d.blink_mode as string | undefined,
        updated_at: d.updated_at as string | undefined,
      });
    }

    let styleFallbackUsed = false;
    const map = new maplibregl.Map({
      container,
      style: mapStyleUrl,
      center: [0, 20],
      zoom: 1,
    });
    mapRef.current = map;

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

    const bounds = new maplibregl.LngLatBounds();

    map.on("load", () => {
      for (const m of list) {
        const el = document.createElement("div");
        el.className = `dash-map-marker ${blinkModeClass(m.blink_mode)}`;
        el.style.width = "18px";
        el.style.height = "18px";
        el.style.borderRadius = "50%";
        el.style.background = healthColorVar(m.health_status);
        el.style.border = "2px solid rgba(255,255,255,0.9)";
        el.style.cursor = "pointer";
        el.title = String(m.display_name ?? "");

        const popupHtml = popupContent(m);
        const popup = new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([m.longitude, m.latitude])
          .setPopup(popup)
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([m.longitude, m.latitude]);
      }

      if (list.length === 1) {
        map.jumpTo({ center: [list[0].longitude, list[0].latitude], zoom: 10 });
      } else if (list.length > 1) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
      }
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [block.widget_id, mode, JSON.stringify(d.markers), d.latitude, d.longitude, mapStyleUrl]);

  if (d.error) {
    return (
      <div className="dash-widget">
        <h3 className="dash-widget__title">{block.title}</h3>
        <p style={{ color: "#f66" }}>{String(d.error)}</p>
      </div>
    );
  }

  return (
    <div className="dash-widget dash-widget--map">
      <h3 className="dash-widget__title">{block.title}</h3>
      {styleNotice && (
        <p className="dash-widget__muted" style={{ fontSize: "0.8rem", marginBottom: "0.35rem" }}>
          {styleNotice}
        </p>
      )}
      <div ref={containerRef} style={{ height: 320, width: "100%", borderRadius: "var(--radius)", overflow: "hidden" }} />
    </div>
  );
}

function popupContent(m: MarkerRec): string {
  const title = m.display_name || m.device_name || "Object";
  const site = m.site_name ? `<div style="opacity:.8;font-size:12px">${escapeHtml(m.site_name)}</div>` : "";
  const kpis = m.kpis
    ? Object.entries(m.kpis)
        .map(([k, v]) => `<div><strong>${escapeHtml(k)}</strong>: ${escapeHtml(String(v ?? "—"))}</div>`)
        .join("")
    : "";
  const health = m.health_status
    ? `<div>Health: <strong>${escapeHtml(m.health_status)}</strong></div>`
    : "";
  const hmsg = m.health_message
    ? `<div style="font-size:12px;opacity:.9;margin-top:2px">${escapeHtml(m.health_message)}</div>`
    : "";
  const updated = m.updated_at ? `<div style="opacity:.75;font-size:11px;margin-top:4px">${escapeHtml(m.updated_at)}</div>` : "";
  return `<div style="min-width:200px;color:#111"><strong>${escapeHtml(title)}</strong>${site}${health}${hmsg}${kpis}${updated}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
