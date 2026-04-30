import { useEffect, useMemo, useState } from "react";
import { getTrendsWindow } from "@/api/trends";
import { formatMetricValue } from "@/lib/formatMetricValue";
import type { TrendBucketPointDTO, TrendPopupProps, TrendsWindowResponseDTO } from "@/types/trends";

const floatMeta = { type: "float" as const, decimals: 2 };
const intMeta = { type: "integer" as const };

/**
 * Lazy-loaded map popup body: fetches GET /trends/window and shows compact bucket stats.
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

  const allEmpty =
    data != null && keys.every((k) => (data.series[k] ?? []).length === 0);

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
      {!loading && !err && data && allEmpty ? (
        <p className="dash-map-popup__hint" role="status">
          No trend data available yet.
        </p>
      ) : null}
      {!loading && !err && data && !allEmpty ? (
        <div className="dash-map-popup__trend-metrics">
          {keys.map((mk) => (
            <TrendMetricBlock key={mk} metricKey={mk} points={data.series[mk] ?? []} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TrendMetricBlock({ metricKey, points }: { metricKey: string; points: TrendBucketPointDTO[] }) {
  if (!points.length) {
    return (
      <div className="dash-map-popup__trend-metric">
        <div className="dash-map-popup__trend-metric-name">{metricKey}</div>
        <p className="dash-map-popup__hint">No trend data available yet.</p>
      </div>
    );
  }
  const last = points[points.length - 1];
  return (
    <div className="dash-map-popup__trend-metric">
      <div className="dash-map-popup__trend-metric-name">{metricKey}</div>
      <table className="dash-map-popup__table dash-map-popup__table--compact">
        <tbody>
          <tr>
            <th scope="row">Last bucket</th>
            <td>{last.ts}</td>
          </tr>
          <tr>
            <th scope="row">avg</th>
            <td>{formatMetricValue(last.avg, floatMeta)}</td>
          </tr>
          <tr>
            <th scope="row">min</th>
            <td>{formatMetricValue(last.min, floatMeta)}</td>
          </tr>
          <tr>
            <th scope="row">max</th>
            <td>{formatMetricValue(last.max, floatMeta)}</td>
          </tr>
          <tr>
            <th scope="row">stddev</th>
            <td>{formatMetricValue(last.stddev, floatMeta)}</td>
          </tr>
          <tr>
            <th scope="row">n</th>
            <td>{formatMetricValue(last.n, intMeta)}</td>
          </tr>
          <tr>
            <th scope="row">partial</th>
            <td>{last.is_partial ? "yes" : "no"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
