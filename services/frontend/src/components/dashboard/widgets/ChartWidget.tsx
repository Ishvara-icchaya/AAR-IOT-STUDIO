import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";

export function ChartWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const ref = useRef<HTMLDivElement>(null);
  const d = block.data ?? {};
  const series = (d.series as { x?: unknown[]; y?: unknown[] }) || {};
  const xs = Array.isArray(series.x) ? series.x : [];
  const ys = Array.isArray(series.y) ? series.y : [];
  const chartType = String(d.chart_type ?? "line").toLowerCase();
  const tw = String(d.chart_time_window ?? "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const xData = xs.map((x) => (x === null || x === undefined ? "" : String(x)));
    const isBar = chartType === "bar" || chartType === "stacked_bar" || chartType === "histogram";
    const seriesType = isBar ? "bar" : "line";
    const isHistogram = chartType === "histogram";
    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#8b9cb3" },
      grid: { left: 48, right: 16, top: 24, bottom: 32 },
      xAxis: { type: "category", data: xData },
      yAxis: { type: "value", scale: true },
      series: [
        {
          type: seriesType,
          data: ys,
          stack: chartType === "stacked_bar" ? "stack" : undefined,
          areaStyle: chartType === "area" ? {} : undefined,
          smooth:
            chartType !== "bar" && chartType !== "stacked_bar" && chartType !== "histogram",
          barCategoryGap: isHistogram ? "4%" : undefined,
          barMaxWidth: isHistogram ? 48 : undefined,
          itemStyle: { color: "#3d9aed" },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [block.widget_id, chartType, xs.length, ys.length, xs.join(","), ys.join(",")]);

  const xLabel = String(d.x_field ?? "t");
  const yLabel = String(d.y_field ?? "value");
  const twLabel =
    tw === "1h"
      ? "Last hour"
      : tw === "24h"
        ? "Last 24h"
        : tw === "7d"
          ? "Last 7d"
          : tw === "all"
            ? "All data"
            : tw || "";

  return (
    <div className="dash-widget dash-widget--chart">
      <h3 className="dash-widget__title">{block.title}</h3>
      <p className="dash-widget__muted" style={{ fontSize: "0.75rem", margin: "-0.35rem 0 0.45rem" }}>
        X: {xLabel} (time) · Y: {yLabel}
        {twLabel ? ` · ${twLabel}` : ""}
      </p>
      <div ref={ref} className="dash-widget__chart-canvas" style={{ height: 260, width: "100%" }} />
    </div>
  );
}
