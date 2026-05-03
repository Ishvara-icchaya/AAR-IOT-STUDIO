import { createRoot, type Root } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { MapMarkerPopupRoot } from "./MapMarkerPopupRoot";

export function openDashboardMapMarkerPopup(
  map: maplibregl.Map,
  opts: {
    lngLat: maplibregl.LngLatLike;
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
    /**
     * Expanded “Intelligence view”: popups must sit above panels and avoid tight max-width
     * so tables are usable; grid map uses a compact card.
     */
    expandedMapIntel?: boolean;
  },
): maplibregl.Popup {
  const host = document.createElement("div");
  const intel = opts.expandedMapIntel === true;
  const popup = new maplibregl.Popup({
    anchor: intel ? "bottom" : "top",
    offset: intel ? 12 : 10,
    maxWidth: intel ? "520px" : "380px",
    className: `dash-map-popup-shell${intel ? " dash-map-popup-shell--intel-view" : " dash-map-popup-shell--grid"}`,
    closeButton: true,
    closeOnClick: false,
  })
    .setLngLat(opts.lngLat)
    .setDOMContent(host)
    .addTo(map);

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
  };
  popup.on("close", cleanup);

  root.render(
    <MapMarkerPopupRoot
      siteId={opts.siteId}
      sourceType={opts.sourceType}
      sourceId={opts.sourceId}
      title={opts.title}
      blockedMessage={opts.blockedMessage}
      trendScope={opts.trendScope}
      kpiKeys={opts.kpiKeys}
      detailRefreshIntervalSec={opts.detailRefreshIntervalSec}
      detailRenderEpoch={opts.detailRenderEpoch}
    />,
  );

  return popup;
}
