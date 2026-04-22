import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import type { OpsTrendDay } from "./operationsOverviewModel";

type Props = { title: string; series: OpsTrendDay[]; dataRevision: string };

export function OverviewTrendCard({ title, series, dataRevision }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const seriesSig = useMemo(
    () => series.map((d) => `${d.day ?? ""}:${d.warning ?? 0}:${d.critical ?? 0}`).join("|"),
    [series],
  );

  useEffect(() => {
    const el = hostRef.current;
    if (!el || series.length === 0) return;

    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const labels = series.map((d) => String(d.label ?? ""));
    const warn = series.map((d) => Number(d.warning) || 0);
    const crit = series.map((d) => Number(d.critical) || 0);
    const total = warn.map((w, i) => w + (crit[i] ?? 0));
    const n = labels.length;
    const labelInterval = n <= 8 ? 0 : 1;

    chart.setOption({
      color: ["#dc2626", "#d97706", "#e2e8f0"],
      textStyle: { fontSize: 11, color: "#8b9cb3" },
      animationDuration: 520,
      animationEasing: "cubicOut",
      grid: { left: 40, right: 14, top: 28, bottom: 28 },
      legend: {
        top: 2,
        right: 10,
        itemWidth: 11,
        itemHeight: 11,
        textStyle: { fontSize: 11, color: "#8b9cb3" },
        data: [
          { name: "Critical", icon: "roundRect" },
          { name: "Warning", icon: "roundRect" },
          { name: "Total", icon: "roundRect" },
        ],
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        textStyle: { fontSize: 11 },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          color: "#8b9cb3",
          interval: labelInterval,
        },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
        axisLabel: { fontSize: 10, color: "#8b9cb3" },
      },
      series: [
        {
          name: "Critical",
          type: "bar",
          stack: "alerts",
          barWidth: "52%",
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#fca5a5" },
              { offset: 1, color: "#991b1b" },
            ]),
            borderRadius: [4, 4, 0, 0],
          },
          data: crit,
        },
        {
          name: "Warning",
          type: "bar",
          stack: "alerts",
          barWidth: "52%",
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#fcd34d" },
              { offset: 1, color: "#b45309" },
            ]),
            borderRadius: [4, 4, 0, 0],
          },
          data: warn,
        },
        {
          name: "Total",
          type: "line",
          smooth: 0.25,
          yAxisIndex: 0,
          showSymbol: true,
          symbolSize: 5,
          lineStyle: { width: 2, color: "rgba(226,232,240,0.55)" },
          itemStyle: { color: "#e2e8f0" },
          tooltip: { valueFormatter: (v: number) => `${v} alerts` },
          data: total,
        },
      ],
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [series, seriesSig, dataRevision]);

  if (series.length === 0) {
    return (
      <article className="ops-card ops-card--trend ops-card--priority">
        <header className="ops-card__head">
          <h2 className="ops-card__title">{title}</h2>
        </header>
        <div className="ops-card__body">
          <p className="ops-overview-empty">No alert trend data in this range</p>
        </div>
      </article>
    );
  }

  return (
    <article className="ops-card ops-card--trend ops-card--priority">
      <header className="ops-card__head">
        <h2 className="ops-card__title">{title}</h2>
      </header>
      <div className="ops-card__body">
        <div ref={hostRef} className="ops-overview-trend-chart" role="img" aria-label="Alert trends" />
      </div>
    </article>
  );
}
