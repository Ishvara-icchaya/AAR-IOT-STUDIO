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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const xData = xs.map((x) => (x === null || x === undefined ? "" : String(x)));
    const isBar = chartType === "bar" || chartType === "stacked_bar";
    const seriesType = isBar ? "bar" : "line";
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
          smooth: chartType !== "bar" && chartType !== "stacked_bar",
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

  return (
    <div className="dash-widget dash-widget--chart">
      <h3 className="dash-widget__title">{block.title}</h3>
      <div ref={ref} style={{ height: 260, width: "100%" }} />
    </div>
  );
}
