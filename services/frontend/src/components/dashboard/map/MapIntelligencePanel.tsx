import { useId } from "react";

type Props = {
  siteId: string | null;
  blockTitle: string;
  markerCount: number;
};

/**
 * Phase 1 placeholder for Expanded Map Intelligence (endpoint summary, device list, selection).
 * Runtime metrics and GET /map/expanded wire-up land in later phases.
 */
export function MapIntelligencePanel({ siteId, blockTitle, markerCount }: Props) {
  const searchId = useId();
  return (
    <aside
      className="dash-map-intel"
      aria-label="Map intelligence"
    >
      <div className="dash-map-intel__head">
        <h4 className="dash-map-intel__title">Intelligence</h4>
        <p className="dash-map-intel__subtitle">{blockTitle}</p>
      </div>

      <section className="dash-map-intel__section" aria-labelledby="dash-map-intel-endpoint">
        <h5 id="dash-map-intel-endpoint" className="dash-map-intel__section-title">
          Endpoint summary
        </h5>
        <dl className="dash-map-intel__dl">
          <div>
            <dt>Site</dt>
            <dd>{siteId ?? "—"}</dd>
          </div>
          <div>
            <dt>Markers on map</dt>
            <dd>{markerCount}</dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd className="dash-map-intel__muted">Wired in Phase 3 (aggregates + trends).</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd className="dash-map-intel__muted">Computed server-side in Phase 2.</dd>
          </div>
        </dl>
      </section>

      <section className="dash-map-intel__section" aria-labelledby="dash-map-intel-devices">
        <h5 id="dash-map-intel-devices" className="dash-map-intel__section-title">
          Devices
        </h5>
        <label className="dash-map-intel__search-label" htmlFor={searchId}>
          Search
        </label>
        <input
          id={searchId}
          type="search"
          className="dash-map-intel__search"
          placeholder="Filter devices…"
          disabled
          aria-describedby="dash-map-intel-devices-hint"
        />
        <p id="dash-map-intel-devices-hint" className="dash-map-intel__hint">
          Paginated, searchable list and click-to-select arrive in Phase 2 (runtime intelligence API).
        </p>
      </section>

      <section className="dash-map-intel__section" aria-labelledby="dash-map-intel-detail">
        <h5 id="dash-map-intel-detail" className="dash-map-intel__section-title">
          Selected device
        </h5>
        <p className="dash-map-intel__muted">
          Open a marker for the small popup, or select a device here once the list is live. Detail, KPIs, trends, and
          playback will anchor in this panel (not the popup).
        </p>
      </section>
    </aside>
  );
}
