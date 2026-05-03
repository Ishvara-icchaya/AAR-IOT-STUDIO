import { useEffect, useMemo, useState } from "react";
import { getTrendsWindow } from "@/api/trends";
import { formatMetricValue } from "@/lib/formatMetricValue";
import { formatTrendLocalTime, MapTrendSparkline } from "@/components/dashboard/map/MapTrendSparkline";
import type { TrendBucketPointDTO, TrendPopupProps, TrendsWindowResponseDTO } from "@/types/trends";

const floatMeta = { type: "float" as const, decimals: 2 };

function totalSamples(points: TrendBucketPointDTO[]): number {
  let s = 0;
  for (const p of points) {
    if (typeof p.n === "number" && Number.isFinite(p.n)) s += p.n;
  }
  return s > 0 ? s : points.length;
}

/**
 * Lazy-loaded map popup: GET /trends/window — same KPI table for 1h / 24h.
 */
export default function TrendPopup(props: TrendPopupProps & { siteId: string }) {
  const { siteId, scope, entityId, metricKeys, defaultWindow, asOf } = props;
  const [windowSel, setWindowSel] = useState<"1h" | "24h">(defaultWindow);
  const [data, setData] = useState<TrendsWindowResponseDTO | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const keys = useMemo(() => metricKeys.filter(Boolean).slice(0, 16), [metricKeys]);
  const keysSig = keys.join("\u0001");

  useEffect(() => {
    if (!siteId || !entityId || keys.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const r = await getTrendsWindow({
          siteId,
          scope,
          entityId,
          metrics: keys,
          window: windowSel,
          asOf,
        });
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Trend request failed");
          setData(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, scope, entityId, windowSel, asOf, keysSig]);

  if (keys.length === 0) {
    return <p className="dash-map-popup__hint">No metrics configured for trends.</p>;
  }

  return (
    <div className="dash-map-popup__section dash-map-popup__section--trend">
      <div className="dash-map-popup__section-title">Trends</div>
      <div className="dash-map-popup__trend-toggle" role="group" aria-label="Window">
        <button
          type="button"
          className={windowSel === "1h" ? "is-active" : ""}
          onClick={() => setWindowSel("1h")}
        >
          1h
        </button>
        <button
          type="button"
          className={windowSel === "24h" ? "is-active" : ""}
          onClick={() => setWindowSel("24h")}
        >
          24h
        </button>
      </div>
      {loading ? <p className="dash-map-popup__hint">Loading trend…</p> : null}
      {err ? <p className="dash-map-popup__msg">{err}</p> : null}
      {!loading && !err && data ? (
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
                const points = data.series[mk] ?? [];
                if (!points.length) {
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
                const last = points[points.length - 1]!;
                const sparkVals = points.map((p) => p.avg);
                return (
                  <tr key={mk}>
                    <th scope="row">{mk}</th>
                    <td>{totalSamples(points)}</td>
                    <td>{formatMetricValue(last.avg, floatMeta)}</td>
                    <td>{formatTrendLocalTime(last.ts)}</td>
                    <td className="dash-map-popup__td--spark">
                      <MapTrendSparkline values={sparkVals} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
