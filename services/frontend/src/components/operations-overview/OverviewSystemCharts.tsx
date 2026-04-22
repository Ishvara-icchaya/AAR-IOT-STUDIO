import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { CommandCenterPayload } from "./operationsOverviewCommandCenter";

type Props = { cc: CommandCenterPayload; dataRevision: string };

export function OverviewSystemCharts({ cc, dataRevision }: Props) {
  const ingestRef = useRef<HTMLDivElement>(null);
  const latRef = useRef<HTMLDivElement>(null);
  const ingestSig = useMemo(
    () => cc.ingestion_series.map((p) => `${p.label}:${p.count ?? 0}`).join("|"),
    [cc.ingestion_series],
  );
  const latSig = useMemo(
    () => cc.latency_series.map((p) => `${p.label}:${p.latency_ms ?? 0}`).join("|"),
    [cc.latency_series],
  );

  useEffect(() => {
    const el = ingestRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const labels = cc.ingestion_series.map((p) => String(p.label ?? ""));
    const rates = cc.ingestion_series.map((p) => Number(p.rate_per_min) || 0);
    chart.setOption({
      animationDuration: 380,
      textStyle: { color: "#8b9cb3", fontSize: 11 },
      grid: { left: 42, right: 10, top: 22, bottom: 22 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { fontSize: 9, color: "#8b9cb3", interval: labels.length > 16 ? 3 : labels.length > 10 ? 2 : 0 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
      },
      yAxis: {
        type: "value",
        name: "msg/min",
        nameTextStyle: { fontSize: 10, color: "#64748b" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
        axisLabel: { fontSize: 10, color: "#8b9cb3" },
      },
      series: [
        {
          type: "line",
          smooth: 0.35,
          showSymbol: false,
          lineStyle: { width: 2.5, color: "#38bdf8" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(56,189,248,0.35)" },
              { offset: 1, color: "rgba(56,189,248,0.02)" },
            ]),
          },
          data: rates,
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [cc.ingestion_series, ingestSig, dataRevision]);

  useEffect(() => {
    const el = latRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const labels = cc.latency_series.map((p) => String(p.label ?? ""));
    const vals = cc.latency_series.map((p) => Number(p.latency_ms) || 0);
    chart.setOption({
      animationDuration: 380,
      textStyle: { color: "#8b9cb3", fontSize: 11 },
      grid: { left: 44, right: 10, top: 22, bottom: 22 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { fontSize: 9, color: "#8b9cb3", interval: labels.length > 16 ? 3 : labels.length > 10 ? 2 : 0 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
      },
      yAxis: {
        type: "value",
        name: "ms",
        nameTextStyle: { fontSize: 10, color: "#64748b" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
        axisLabel: { fontSize: 10, color: "#8b9cb3" },
      },
      series: [
        {
          type: "line",
          smooth: 0.35,
          showSymbol: false,
          lineStyle: { width: 2.5, color: "#a78bfa" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(167,139,250,0.32)" },
              { offset: 1, color: "rgba(167,139,250,0.02)" },
            ]),
          },
          data: vals,
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [cc.latency_series, latSig, dataRevision]);

  return (
    <div className="ops-overview-row-monitor">
      <article className="ops-card ops-card--monitor">
        <header className="ops-card__head">
          <h2 className="ops-card__title">Ingestion rate</h2>
          <span className="ops-card__tag">REST · live</span>
        </header>
        <div className="ops-card__body">
          <div ref={ingestRef} className="ops-monitor-chart" role="img" aria-label="Ingestion rate" />
        </div>
      </article>
      <article className="ops-card ops-card--monitor">
        <header className="ops-card__head">
          <h2 className="ops-card__title">Processing latency</h2>
          <span className="ops-card__tag">Estimated</span>
        </header>
        <div className="ops-card__body">
          <div ref={latRef} className="ops-monitor-chart" role="img" aria-label="Processing latency" />
        </div>
      </article>
    </div>
  );
}
