import { useMemo, useState } from "react";
import { formatMetricValue } from "@/lib/formatMetricValue";
import { formatTrendLocalTime, MapTrendSparkline } from "@/components/dashboard/map/MapTrendSparkline";

type KpiRow = { t: string; kpi_key?: string; value?: number | null };

const floatMeta = { type: "float" as const, decimals: 2 };

type Props = {
  detail: Record<string, unknown>;
  metricKeys: string[];
};

/**
 * Map popup: Timescale `kpi_history_timescale` samples — same table layout for 1h / 24h.
 */
export default function MapObjectKpiTrendPopup(props: Props) {
  const { detail, metricKeys } = props;
  const [win, setWin] = useState<"1h" | "24h">("1h");
  const hist = detail.kpi_history_timescale as { "1h"?: KpiRow[]; "24h"?: KpiRow[] } | undefined;

  const rowsByMetric = useMemo(() => {
    const bucket = win === "1h" ? hist?.["1h"] : hist?.["24h"];
    const rows = Array.isArray(bucket) ? bucket : [];
    const m: Record<string, KpiRow[]> = {};
    for (const mk of metricKeys.slice(0, 16)) {
      m[mk] = rows
        .filter((r) => r.kpi_key === mk)
        .sort((a, b) => String(a.t).localeCompare(String(b.t)));
    }
    return m;
  }, [hist, win, metricKeys]);

  if (metricKeys.length === 0) {
    return <p className="dash-map-popup__hint">No metrics configured for trends.</p>;
  }

  const keys = metricKeys.slice(0, 16);

  return (
    <div className="dash-map-popup__section dash-map-popup__section--trend">
      <div className="dash-map-popup__section-title">KPI history (Timescale)</div>
      <p className="dash-map-popup__hint dash-map-popup__hint--static">
        Sample points from map history (not Redis 5m buckets).
      </p>
      <div className="dash-map-popup__trend-toggle" role="group" aria-label="Window">
        <button type="button" className={win === "1h" ? "is-active" : ""} onClick={() => setWin("1h")}>
          1h
        </button>
        <button type="button" className={win === "24h" ? "is-active" : ""} onClick={() => setWin("24h")}>
          24h
        </button>
      </div>
      <div className="dash-map-popup__table-wrap dash-map-popup__table-wrap--trend">
        <table className="dash-map-popup__table dash-map-popup__table--kpi-trend">
          <thead>
            <tr>
              <th scope="col">KPI</th>
              <th scope="col"># of samples</th>
              <th scope="col">Latest</th>
              <th scope="col">Local time</th>
              <th scope="col">Trend</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((mk) => {
              const pts = rowsByMetric[mk] ?? [];
              if (!pts.length) {
                return (
                  <tr key={mk}>
                    <th scope="row">{mk}</th>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td className="dash-map-popup__td--spark">
                      <span className="dash-map-popup__spark-empty">—</span>
                    </td>
                  </tr>
                );
              }
              const last = pts[pts.length - 1]!;
              const sparkVals = pts.map((r) => r.value);
              return (
                <tr key={mk}>
                  <th scope="row">{mk}</th>
                  <td>{pts.length}</td>
                  <td>{formatMetricValue(last.value, floatMeta)}</td>
                  <td>{formatTrendLocalTime(last.t)}</td>
                  <td className="dash-map-popup__td--spark">
                    <MapTrendSparkline values={sparkVals} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
