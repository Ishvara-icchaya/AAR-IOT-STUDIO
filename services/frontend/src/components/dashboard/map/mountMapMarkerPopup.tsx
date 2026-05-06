import { createRoot, type Root } from "react-dom/client";
import type maplibregl from "maplibre-gl";
import { AppModalShell } from "@/components/app/AppModalShell";
import { DEFAULT_MAP_STYLE_URL } from "@/lib/dashboardMapStyle";
import { MapMarkerModalSplit, normalizeLngLatLike } from "./MapMarkerModalSplit";
import { MapMarkerPopupRoot } from "./MapMarkerPopupRoot";

export function openDashboardMapMarkerPopup(
  _map: maplibregl.Map,
  opts: {
    /** Device location for the right-hand preview map in the modal. */
    lngLat?: maplibregl.LngLatLike;
    /** Basemap for the preview map (dashboard runtime style when provided). */
    mapStyleUrl?: string;
    title: string;
    siteId: string;
    sourceType: string;
    sourceId: string;
    blockedMessage?: string;
    /** Map detail API: trend_context scope for LDS (resolved_device | endpoint | site). */
    trendScope?: "resolved_device" | "endpoint" | "site";
    /** When set, passed as repeated kpiKeys query params so detail KPIs match the map widget binding. */
    kpiKeys?: string[];
    /** When popup is mounted outside DashboardLiveProvider, pass live refresh meta from the map widget. */
    detailRefreshIntervalSec?: number;
    detailRenderEpoch?: string;
    /** Wider modal when opened from the intelligence map (tables / trends). */
    expandedMapIntel?: boolean;
  },
): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      root.unmount();
    } catch {
      /* noop */
    }
    host.remove();
  };

  const size = opts.expandedMapIntel === true ? "xl" : "lg";
  const dialogClass = "dash-map-marker-detail-modal";
  const mapCenter = normalizeLngLatLike(opts.lngLat);
  const mapStyleUrl = opts.mapStyleUrl?.trim() || DEFAULT_MAP_STYLE_URL;

  root.render(
    <AppModalShell
      open
      title={opts.title}
      onClose={cleanup}
      size={size}
      dialogClassName={dialogClass}
    >
      <MapMarkerModalSplit
        mapCenter={mapCenter}
        mapStyleUrl={mapStyleUrl}
        detail={
          <MapMarkerPopupRoot
            inModal
            siteId={opts.siteId}
            sourceType={opts.sourceType}
            sourceId={opts.sourceId}
            title={opts.title}
            blockedMessage={opts.blockedMessage}
            trendScope={opts.trendScope}
            kpiKeys={opts.kpiKeys}
            detailRefreshIntervalSec={opts.detailRefreshIntervalSec}
            detailRenderEpoch={opts.detailRenderEpoch}
          />
        }
      />
    </AppModalShell>,
  );
}
