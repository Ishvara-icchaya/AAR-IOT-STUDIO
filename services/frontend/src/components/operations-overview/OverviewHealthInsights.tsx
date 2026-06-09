import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { CommandCenterPayload } from "./operationsOverviewCommandCenter";

type Props = { cc: CommandCenterPayload; dataRevision: string };

export function OverviewHealthInsights({ cc, dataRevision }: Props) {
  const donutRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const health = cc.health_distribution;
  const topSig = useMemo(() => cc.top_alert_devices.map((d) => `${d.device_name}:${d.count}`).join("|"), [cc.top_alert_devices]);

  useEffect(() => {
    const el = donutRef.current;
    if (!el || !health) return;
    const donutSum = health.online + health.degraded + health.offline;
    if (donutSum <= 0) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDuration: 400,
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["52%", "78%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          label: { fontSize: 10, color: "#475569" },
          data: [
            { value: health.online, name: "Online", itemStyle: { color: "#5fd4a8" } },
            { value: health.degraded, name: "Degraded", itemStyle: { color: "#fcd34d" } },
            { value: health.offline, name: "Offline", itemStyle: { color: "#f9a8b4" } },
          ],
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [health, dataRevision]);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const names = cc.top_alert_devices.map((d) => (d.device_name.length > 14 ? `${d.device_name.slice(0, 12)}…` : d.device_name));
    const counts = cc.top_alert_devices.map((d) => d.count);
    chart.setOption({
      animationDuration: 400,
      grid: { left: 8, right: 8, top: 8, bottom: 28 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 9, color: "#64748b", rotate: names.some((n) => n.length > 10) ? 28 : 0 },
        axisLine: { lineStyle: { color: "rgba(56, 118, 168, 0.22)" } },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: "rgba(30, 76, 120, 0.09)" } },
        axisLabel: { fontSize: 9, color: "#5c6f82" },
      },
      series: [
        {
          type: "bar",
          data: counts,
          barMaxWidth: 22,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#fbcfe8" },
              { offset: 1, color: "#f472b6" },
            ]),
          },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [cc.top_alert_devices, topSig, dataRevision]);

  return (
    <div className="ops-overview-row-health">
      <article className="ops-card ops-card--health">
        <header className="ops-card__head">
          <h2 className="ops-card__title">Device health</h2>
        </header>
        <div className="ops-card__body">
          {health ? (
            <div ref={donutRef} className="ops-health-donut" role="img" aria-label="Device health distribution" />
          ) : (
            <p className="ops-overview-empty">No distribution</p>
          )}
        </div>
      </article>
      <article className="ops-card ops-card--health">
        <header className="ops-card__head">
          <h2 className="ops-card__title">Top alerting devices</h2>
        </header>
        <div className="ops-card__body">
          {cc.top_alert_devices.length ? (
            <div ref={barRef} className="ops-health-bar" role="img" aria-label="Top alerting devices" />
          ) : (
            <p className="ops-overview-empty">No device-scoped alerts in range</p>
          )}
        </div>
      </article>
    </div>
  );
}
