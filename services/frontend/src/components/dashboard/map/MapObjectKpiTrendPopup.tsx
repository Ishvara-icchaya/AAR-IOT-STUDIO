import { useMemo, useState } from "react";
import { formatMetricValue } from "@/lib/formatMetricValue";

type KpiRow = { t: string; kpi_key?: string; value?: number | null };

const floatMeta = { type: "float" as const, decimals: 2 };

type Props = {
  detail: Record<string, unknown>;
  metricKeys: string[];
};

/**
 * Map popup trends for data_object / result_object: uses `kpi_history_timescale`
 * from map detail (Timescale samples), not Redis 5m windows.
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

  const allEmpty = metricKeys.slice(0, 16).every((mk) => (rowsByMetric[mk] ?? []).length === 0);

  return (
    <div className="dash-map-popup__section dash-map-popup__section--trend">
      <div className="dash-map-popup__section-title">KPI history (Timescale)</div>
      <p className="dash-map-popup__hint">Sample points from map history (not Redis 5m buckets).</p>
      <div className="dash-map-popup__trend-toggle" role="group" aria-label="Window">
        <button type="button" className={win === "1h" ? "is-active" : ""} onClick={() => setWin("1h")}>
          1h
        </button>
        <button type="button" className={win === "24h" ? "is-active" : ""} onClick={() => setWin("24h")}>
          24h
        </button>
      </div>
      {allEmpty ? (
        <p className="dash-map-popup__hint" role="status">
          No trend data available yet.
        </p>
      ) : (
        <div className="dash-map-popup__trend-metrics">
          {metricKeys.slice(0, 16).map((mk) => {
            const pts = rowsByMetric[mk] ?? [];
            if (!pts.length) {
              return (
                <div key={mk} className="dash-map-popup__trend-metric">
                  <div className="dash-map-popup__trend-metric-name">{mk}</div>
                  <p className="dash-map-popup__hint">No samples in this window.</p>
                </div>
              );
            }
            const last = pts[pts.length - 1]!;
            const tail = pts.slice(-5).reverse();
            return (
              <div key={mk} className="dash-map-popup__trend-metric">
                <div className="dash-map-popup__trend-metric-name">{mk}</div>
                <table className="dash-map-popup__table dash-map-popup__table--compact">
                  <tbody>
                    <tr>
                      <th scope="row">Latest</th>
                      <td>{formatMetricValue(last.value, floatMeta)} @ {last.t}</td>
                    </tr>
                    <tr>
                      <th scope="row">Samples</th>
                      <td>{pts.length}</td>
                    </tr>
                    {tail.map((r) => (
                      <tr key={`${mk}-${r.t}`}>
                        <th scope="row">{r.t}</th>
                        <td>{formatMetricValue(r.value, floatMeta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
