import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { adaptChartWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";

/** Apache ECharts — canonical dashboard chart renderer. */
export function ChartWidgetRenderer({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const vm = adaptChartWidget(block);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const xs = vm.seriesX;
  const ys = vm.seriesY;
  const chartType = vm.chartType;
  const tw = vm.chartTimeWindow;

  useEffect(() => {
    const el = ref.current;
    const wrap = bodyRef.current;
    if (!el || !wrap) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const xData = xs.map((x) => (x === null || x === undefined ? "" : String(x)));
    const isBar = chartType === "bar" || chartType === "stacked_bar" || chartType === "histogram";
    const seriesType = isBar ? "bar" : "line";
    const isHistogram = chartType === "histogram";

    const applyLayout = () => {
      const h = Math.max(wrap.clientHeight, 80);
      const fs = Math.max(9, Math.min(14, Math.round(h * 0.034)));
      chart.setOption({
        textStyle: { fontSize: fs, color: "#8b9cb3" },
        grid: {
          left: Math.max(36, fs * 3),
          right: 12,
          top: fs * 2,
          bottom: fs * 2.5,
        },
      });
      chart.resize();
    };

    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#8b9cb3" },
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
    applyLayout();
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [block.widget_id, chartType, xs.length, ys.length, xs.join(","), ys.join(",")]);

  const xLabel = vm.xField;
  const yLabel = vm.yField;
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

  const subtitle = `X: ${xLabel} (time) · Y: ${yLabel}${twLabel ? ` · ${twLabel}` : ""}`;
  const updated = vm.updatedAt;
  const hasSeries = xs.length > 0 || ys.length > 0;
  const frameState = !hasSeries ? "empty" : "normal";

  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state={frameState}
      widgetKind="chart"
      bodyFill
      emptyMessage="No series data for the current binding."
      subtitle={<span className="dash-wf-chart__subtitle">{subtitle}</span>}
      sourceLine={pres.showSource ? `${yLabel} vs ${xLabel}` : null}
      updatedAtLine={pres.showUpdatedAt && updated ? `Updated ${new Date(updated).toLocaleString()}` : null}
    >
      <div ref={bodyRef} className="dash-wf-chart__plot">
        <div ref={ref} className="dash-widget__chart-canvas" />
      </div>
    </DashboardWidgetFrame>
  );
}
