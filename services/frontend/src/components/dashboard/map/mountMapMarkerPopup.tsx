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
  },
): maplibregl.Popup {
  const host = document.createElement("div");
  const popup = new maplibregl.Popup({
    offset: 18,
    maxWidth: "380px",
    className: "dash-map-popup-shell",
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
    />,
  );

  return popup;
}
