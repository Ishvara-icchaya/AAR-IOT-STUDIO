import type { MapLayerControls } from "@/lib/dashboard/mapLayerControls";

type Props = {
  value: MapLayerControls;
  onChange: (next: MapLayerControls) => void;
  /** Cockpit: row-wrap layout for expanded map layers column. */
  variant?: "default" | "cockpit";
};

function patch<K extends keyof MapLayerControls>(cur: MapLayerControls, key: K, val: MapLayerControls[K]): MapLayerControls {
  return { ...cur, [key]: val };
}

export function MapLayerControlPanel({ value: lc, onChange, variant = "default" }: Props) {
  const cockpit = variant === "cockpit";
  return (
    <section
      className={`dash-map-layers${cockpit ? " dash-map-layers--cockpit-rows" : ""}`}
      aria-labelledby="dash-map-layers-heading"
    >
      {!cockpit ? (
        <h4 id="dash-map-layers-heading" className="dash-map-layers__title">
          Map layers
        </h4>
      ) : (
        <span id="dash-map-layers-heading" className="dash-map-layers__title dash-map-layers__title--sr">
          Map layers
        </span>
      )}
      <div
        className="dash-map-layers__single-line"
        role="group"
        aria-label="Layers and marker filter (one row)"
      >
        <span className="dash-map-layers__inline-tag">Layers</span>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showLiveMarkers}
                onChange={(e) => onChange(patch(lc, "showLiveMarkers", e.target.checked))}
              />
              <span>Live devices</span>
            </label>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showAggregatedDeviceMarkers}
                onChange={(e) => onChange(patch(lc, "showAggregatedDeviceMarkers", e.target.checked))}
              />
              <span>Aggregated device markers</span>
            </label>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showEndpointGroups}
                onChange={(e) => onChange(patch(lc, "showEndpointGroups", e.target.checked))}
              />
              <span>Endpoint groups</span>
            </label>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showTraceRoute}
                onChange={(e) => onChange(patch(lc, "showTraceRoute", e.target.checked))}
              />
              <span>Trace</span>
            </label>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showReplayHead}
                onChange={(e) => onChange(patch(lc, "showReplayHead", e.target.checked))}
              />
              <span>Replay head</span>
            </label>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showGapPoints}
                onChange={(e) => onChange(patch(lc, "showGapPoints", e.target.checked))}
              />
              <span>Stale / gap points</span>
            </label>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showStartEndAnchors}
                onChange={(e) => onChange(patch(lc, "showStartEndAnchors", e.target.checked))}
              />
              <span>Start / end anchors</span>
            </label>
            <label className="dash-map-layers__row dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="checkbox"
                checked={lc.showLabels}
                onChange={(e) => onChange(patch(lc, "showLabels", e.target.checked))}
              />
              <span>Labels</span>
            </label>

        <span className="dash-map-layers__inline-sep" aria-hidden />
        <span className="dash-map-layers__inline-tag">Filter</span>
            <label className="dash-map-layers__radio dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="radio"
                name="map-layer-filter"
                checked={lc.filterMode === "all"}
                onChange={() => onChange(patch(lc, "filterMode", "all"))}
              />
              <span>All</span>
            </label>
            <label className="dash-map-layers__radio dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="radio"
                name="map-layer-filter"
                checked={lc.filterMode === "stale"}
                onChange={() => onChange(patch(lc, "filterMode", "stale"))}
              />
              <span>Stale only</span>
            </label>
            <label className="dash-map-layers__radio dash-map-layers__cell dash-map-layers__cell--inline">
              <input
                type="radio"
                name="map-layer-filter"
                checked={lc.filterMode === "offline"}
                onChange={() => onChange(patch(lc, "filterMode", "offline"))}
              />
              <span>Offline only</span>
            </label>
      </div>
    </section>
  );
}
