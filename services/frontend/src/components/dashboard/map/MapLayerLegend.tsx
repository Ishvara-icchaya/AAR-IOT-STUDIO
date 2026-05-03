import type { IntelOverlayState } from "@/components/dashboard/map/deckOverlaySiteMap";
import type { MarkerRec } from "@/lib/dashboard/adapters/apiMarkersToRec";
import { healthToRgb } from "@/lib/dashboard/mapViewModel";
import type { MapLayerControls } from "@/lib/dashboard/mapLayerControls";
import { stableHueFromString } from "@/lib/dashboard/mapLayerControls";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function Swatch({ rgba }: { rgba: [number, number, number, number] }) {
  const [r, g, b, a] = rgba;
  return (
    <span
      className="dash-map-legend__swatch"
      style={{ background: `rgba(${r},${g},${b},${(a ?? 255) / 255})` }}
      aria-hidden
    />
  );
}

type Props = {
  layerControls: MapLayerControls;
  markers: MarkerRec[];
  intelOverlay: IntelOverlayState | null;
};

export function MapLayerLegend({ layerControls: lc, markers, intelOverlay }: Props) {
  const mode = lc.colorMode;

  let colorRows: { key: string; label: string; rgba: [number, number, number, number] }[] = [];

  if (mode === "health") {
    colorRows = [
      { key: "ok", label: "Online / OK", rgba: healthToRgb("green") },
      { key: "stale", label: "Stale / late", rgba: healthToRgb("yellow") },
      { key: "off", label: "Offline", rgba: healthToRgb("offline") },
      { key: "err", label: "Error / critical", rgba: healthToRgb("red") },
    ];
  } else if (mode === "group") {
    const idxs = Array.from(
      new Set(
        markers
          .map((m) => m.marker_group_index)
          .filter((x): x is number => typeof x === "number" && Number.isFinite(x)),
      ),
    ).sort((a, b) => a - b);
    colorRows =
      idxs.length > 0
        ? idxs.map((i) => {
            const sample = markers.find((m) => m.marker_group_index === i);
            const hueDeg =
              sample && typeof sample.marker_hue === "number" && Number.isFinite(sample.marker_hue)
                ? sample.marker_hue
                : stableHueFromString(`group:${i}`);
            const rgb = hslToRgb(hueDeg / 360, 0.72, 0.5);
            return { key: `g-${i}`, label: `Group ${i + 1}`, rgba: [...rgb, 232] as [number, number, number, number] };
          })
        : [{ key: "none", label: "No group markers visible", rgba: [148, 163, 184, 220] }];
  } else {
    const deviceKeys = Array.from(
      new Set(markers.map((m) => m.device_id).filter((x): x is string => Boolean(x && String(x).trim()))),
    ).slice(0, 8);
    colorRows =
      deviceKeys.length > 0
        ? deviceKeys.map((id) => {
            const hue = stableHueFromString(id) / 360;
            const rgb = hslToRgb(hue, 0.68, 0.52);
            return {
              key: id,
              label: id.length > 10 ? `${id.slice(0, 8)}…` : id,
              rgba: [...rgb, 232] as [number, number, number, number],
            };
          })
        : [
            {
              key: "src",
              label: "By source (no device_id on markers)",
              rgba: [...hslToRgb(0.55, 0.68, 0.52), 232] as [number, number, number, number],
            },
          ];
  }

  const routeRows: { key: string; label: string; rgba: [number, number, number, number] }[] = [];
  const traces = intelOverlay?.traceRoutes?.filter((r) => r.path.length >= 2) ?? [];
  if (traces.length) {
    for (const r of traces) {
      routeRows.push({
        key: `tr-${r.routeId}`,
        label: r.label?.trim() ? String(r.label).slice(0, 28) : r.routeId.length > 12 ? `${r.routeId.slice(0, 10)}…` : r.routeId,
        rgba: r.color,
      });
    }
  } else if (intelOverlay?.footprint?.length && intelOverlay.footprint.length >= 2) {
    routeRows.push({ key: "path", label: "Trace", rgba: [59, 130, 246, 220] });
  }
  if (routeRows.length || intelOverlay?.gapPoints?.length) {
    if (intelOverlay?.gapPoints?.length) {
      routeRows.push({ key: "gap", label: "Stale gap", rgba: [251, 146, 60, 230] });
    }
    if (intelOverlay?.start) {
      routeRows.push({ key: "start", label: "Start", rgba: [34, 197, 94, 240] });
    }
    if (intelOverlay?.end) {
      routeRows.push({ key: "end", label: "End", rgba: [239, 68, 68, 240] });
    }
    if (intelOverlay?.movingLngLat) {
      routeRows.push({ key: "head", label: "Replay head", rgba: [250, 204, 21, 240] });
    }
  }

  return (
    <div className="dash-map-legend-wrap">
      <section className="dash-map-legend dash-map-legend--colors" aria-label="Color legend">
        <h4 className="dash-map-legend__title">Legend</h4>
        <ul className="dash-map-legend__list dash-map-legend__list--grid">
          {colorRows.map((r) => (
            <li key={r.key} className="dash-map-legend__item">
              <Swatch rgba={r.rgba} />
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      </section>
      {routeRows.length ? (
        <section className="dash-map-legend dash-map-legend--route" aria-label="Trace legend">
          <h4 className="dash-map-legend__title">Trace</h4>
          <ul className="dash-map-legend__list dash-map-legend__list--grid">
            {routeRows.map((r) => (
              <li key={r.key} className="dash-map-legend__item">
                <Swatch rgba={r.rgba} />
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
