import type { MapLayerControls, MapLayerColorMode } from "@/lib/dashboard/mapLayerControls";

type Props = {
  value: MapLayerControls;
  onChange: (next: MapLayerControls) => void;
};

function patch<K extends keyof MapLayerControls>(cur: MapLayerControls, key: K, val: MapLayerControls[K]): MapLayerControls {
  return { ...cur, [key]: val };
}

export function MapLayerControlPanel({ value: lc, onChange }: Props) {
  return (
    <section className="dash-map-layers" aria-labelledby="dash-map-layers-title">
      <h4 id="dash-map-layers-title" className="dash-map-layers__title">
        Layers
      </h4>
      <div className="dash-map-layers__checks">
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showLiveMarkers}
            onChange={(e) => onChange(patch(lc, "showLiveMarkers", e.target.checked))}
          />
          <span>Live devices</span>
        </label>
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showAggregatedDeviceMarkers}
            onChange={(e) => onChange(patch(lc, "showAggregatedDeviceMarkers", e.target.checked))}
          />
          <span>Aggregated device markers</span>
        </label>
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showEndpointGroups}
            onChange={(e) => onChange(patch(lc, "showEndpointGroups", e.target.checked))}
          />
          <span>Endpoint groups</span>
        </label>
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showHistoricalPath}
            onChange={(e) => onChange(patch(lc, "showHistoricalPath", e.target.checked))}
          />
          <span>Historical footprint</span>
        </label>
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showReplayHead}
            onChange={(e) => onChange(patch(lc, "showReplayHead", e.target.checked))}
          />
          <span>Replay head</span>
        </label>
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showGapPoints}
            onChange={(e) => onChange(patch(lc, "showGapPoints", e.target.checked))}
          />
          <span>Stale / gap points</span>
        </label>
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showStartEndAnchors}
            onChange={(e) => onChange(patch(lc, "showStartEndAnchors", e.target.checked))}
          />
          <span>Start / end anchors</span>
        </label>
        <label className="dash-map-layers__row">
          <input
            type="checkbox"
            checked={lc.showLabels}
            onChange={(e) => onChange(patch(lc, "showLabels", e.target.checked))}
          />
          <span>Labels</span>
        </label>
      </div>

      <fieldset className="dash-map-layers__fieldset">
        <legend className="dash-map-layers__legend">Filter</legend>
        <label className="dash-map-layers__radio">
          <input
            type="radio"
            name="map-layer-filter"
            checked={lc.filterMode === "all"}
            onChange={() => onChange(patch(lc, "filterMode", "all"))}
          />
          <span>All</span>
        </label>
        <label className="dash-map-layers__radio">
          <input
            type="radio"
            name="map-layer-filter"
            checked={lc.filterMode === "stale"}
            onChange={() => onChange(patch(lc, "filterMode", "stale"))}
          />
          <span>Stale only</span>
        </label>
        <label className="dash-map-layers__radio">
          <input
            type="radio"
            name="map-layer-filter"
            checked={lc.filterMode === "offline"}
            onChange={() => onChange(patch(lc, "filterMode", "offline"))}
          />
          <span>Offline only</span>
        </label>
      </fieldset>

      <fieldset className="dash-map-layers__fieldset">
        <legend className="dash-map-layers__legend">Color by</legend>
        {(
          [
            ["health", "Health"],
            ["group", "Endpoint group"],
            ["device", "Device"],
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className="dash-map-layers__radio">
            <input
              type="radio"
              name="map-layer-color"
              checked={lc.colorMode === mode}
              onChange={() => onChange(patch(lc, "colorMode", mode as MapLayerColorMode))}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
