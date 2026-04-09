import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { MonitoringSummary } from "@/types/monitoring";

function cssVar(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

type Props = { summary: MonitoringSummary };

/** CPU / memory gauges plus a compact subsystem status chart for the overview tab. */
export function MonitoringOverviewGauges({ summary }: Props) {
  const gaugeCpuRef = useRef<HTMLDivElement>(null);
  const gaugeMemRef = useRef<HTMLDivElement>(null);
  const gaugeLagRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const accent = cssVar("--color-accent", "#3d9aed");
    const muted = cssVar("--color-text-muted", "#8b9cb3");
    const text = cssVar("--color-text", "#e8eef7");
    const warn = cssVar("--page-status-warn-fg", "#fbbf24");

    const mkGauge = (el: HTMLDivElement, title: string, value: number | null, max: number) => {
      const chart = echarts.init(el, undefined, { renderer: "canvas" });
      const has = value != null && !Number.isNaN(value);
      const v = has ? Math.min(max, Math.max(0, value)) : 0;
      chart.setOption({
        backgroundColor: "transparent",
        title: {
          text: title,
          left: "center",
          bottom: 0,
          textStyle: { color: muted, fontSize: 11, fontWeight: 500 },
        },
        series: [
          {
            type: "gauge",
            min: 0,
            max,
            splitNumber: 5,
            radius: "88%",
            center: ["50%", "46%"],
            axisLine: {
              lineStyle: {
                width: 10,
                color: [
                  [0.55, "#4ade80"],
                  [0.85, warn],
                  [1, "#f87171"],
                ],
              },
            },
            pointer: { show: has, itemStyle: { color: accent } },
            axisTick: { distance: -10, length: 6, lineStyle: { color: muted } },
            splitLine: { distance: -12, length: 12, lineStyle: { color: muted } },
            axisLabel: { color: muted, distance: 14, fontSize: 9 },
            detail: {
              valueAnimation: true,
              formatter: () => (has ? String(v) : "n/a"),
              color: has ? text : muted,
              fontSize: 16,
              fontWeight: 600,
              offsetCenter: [0, "24%"],
            },
            data: [{ value: v, name: title }],
          },
        ],
      });
      return chart;
    };

    const cpuEl = gaugeCpuRef.current;
    const memEl = gaugeMemRef.current;
    const lagEl = gaugeLagRef.current;
    const barEl = barRef.current;
    if (!cpuEl || !memEl || !lagEl || !barEl) return;

    const cpu = mkGauge(cpuEl, "CPU %", summary.cpu_percent, 100);
    const mem = mkGauge(memEl, "Memory %", summary.memory_percent, 100);
    const lagRaw = summary.queue_lag_messages;
    const lagMax = lagRaw != null && lagRaw > 0 ? Math.max(100, Math.ceil(lagRaw * 1.15)) : 100;
    const lag = mkGauge(lagEl, "Queue lag (msgs)", lagRaw, lagMax);

    const statusKeys: (keyof MonitoringSummary)[] = [
      "api_status",
      "kafka_status",
      "redis_status",
      "postgres_status",
      "worker_status",
      "mqtt_broker_status",
    ];
    const labels = statusKeys.map((k) => String(k).replace(/_status$/, "").replace(/_/g, " "));
    const scores = statusKeys.map((k) => {
      const s = String(summary[k] ?? "").toLowerCase();
      if (s.includes("health") || s === "ok" || s === "up" || s === "running") return 1;
      if (s.includes("warn") || s.includes("degraded")) return 0.5;
      if (s.includes("down") || s.includes("error") || s.includes("fail")) return 0;
      return 0.35;
    });

    const barChart = echarts.init(barEl, undefined, { renderer: "canvas" });
    barChart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: muted },
      grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
      title: {
        text: "Subsystem signals (normalized)",
        left: 8,
        top: 0,
        textStyle: { color: text, fontSize: 12, fontWeight: 600 },
      },
      xAxis: { type: "value", max: 1, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` } },
      yAxis: { type: "category", data: labels, axisLabel: { fontSize: 10, color: muted } },
      series: [
        {
          type: "bar",
          data: scores.map((s) => ({
            value: s,
            itemStyle: {
              color: s >= 0.9 ? "#4ade80" : s >= 0.45 ? warn : "#f87171",
            },
          })),
          barWidth: "55%",
        },
      ],
    });

    const charts = [cpu, mem, lag, barChart];
    const ro = new ResizeObserver(() => charts.forEach((c) => c.resize()));
    [cpuEl, memEl, lagEl, barEl].forEach((el) => ro.observe(el));

    return () => {
      ro.disconnect();
      charts.forEach((c) => c.dispose());
    };
  }, [summary]);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "var(--color-text)" }}>Live gauges</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <div ref={gaugeCpuRef} style={{ height: 200, minWidth: 0 }} />
        <div ref={gaugeMemRef} style={{ height: 200, minWidth: 0 }} />
        <div ref={gaugeLagRef} style={{ height: 200, minWidth: 0 }} />
      </div>
      <div ref={barRef} style={{ height: 280, width: "100%", minWidth: 0 }} />
    </div>
  );
}
