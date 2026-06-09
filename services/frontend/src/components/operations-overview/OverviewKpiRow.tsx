import type { OpsOverviewKpiData } from "./operationsOverviewModel";
import type { KpiCardExtra } from "./operationsOverviewCommandCenter";
import { OverviewSparkline } from "./OverviewSparkline";

const ROW: {
  id: string;
  key: keyof Pick<OpsOverviewKpiData, "total_devices" | "online" | "degraded" | "offline"> | "last";
  label: string;
  dot?: "online" | "warn" | "offline";
  sub?: string;
  sparkAccent?: string;
}[] = [
  { id: "total_devices", key: "total_devices", label: "Total devices", sub: "In scope", sparkAccent: "#5aaee6" },
  { id: "online", key: "online", label: "Online", dot: "online", sparkAccent: "#3cb878" },
  { id: "degraded", key: "degraded", label: "Degraded", dot: "warn", sub: "Late or awaiting first payload", sparkAccent: "#e8c84a" },
  { id: "offline", key: "offline", label: "Offline", dot: "offline", sparkAccent: "#f08c9a" },
  { id: "last", key: "last", label: "Last data received" },
];

function extraFor(cards: KpiCardExtra[], id: string): KpiCardExtra | undefined {
  return cards.find((c) => c.id === id);
}

function DeltaLine({ pct, label }: { pct: number; label: string | null }) {
  const up = pct > 0;
  const arrow = up ? "↑" : pct < 0 ? "↓" : "→";
  const tone = up ? "ops-kpi-delta--up" : pct < 0 ? "ops-kpi-delta--down" : "ops-kpi-delta--flat";
  return (
    <div className={`ops-kpi-delta ${tone}`} title={label ?? ""}>
      <span className="ops-kpi-delta__arrow" aria-hidden>
        {arrow}
      </span>
      <span className="ops-kpi-delta__pct">{Math.abs(pct).toFixed(0)}%</span>
      {label ? <span className="ops-kpi-delta__lbl">{label}</span> : null}
    </div>
  );
}

export function OverviewKpiRow({ data, kpiCards }: { data: OpsOverviewKpiData; kpiCards: KpiCardExtra[] }) {
  const subLast =
    data.last_device_name && data.last_data_relative && data.last_data_relative !== "—"
      ? `Latest: ${data.last_device_name} · ${data.last_data_relative}`
      : data.last_data_relative && data.last_data_relative !== "—"
        ? `Latest activity: ${data.last_data_relative}`
        : "No recent payloads";

  return (
    <div className="ops-overview-kpis" aria-label="Device summary">
      {ROW.map((def) => {
        const ex = extraFor(kpiCards, def.id);
        if (def.key === "last") {
          return (
            <article key="last" className="ops-card ops-card--kpi">
              <div className="ops-card__body">
                <div className="ops-kpi-label">{def.label}</div>
                <div className="ops-kpi-value-row">
                  <div className="ops-kpi-value ops-kpi-value--text">{data.last_data_relative ?? "—"}</div>
                </div>
                <div className="ops-kpi-sub">{subLast}</div>
              </div>
            </article>
          );
        }
        const k = def.key as "total_devices" | "online" | "degraded" | "offline";
        const v = typeof data[k] === "number" ? data[k] : "—";
        const spark = ex?.sparkline?.length ? ex.sparkline : [];
        const dPct = ex?.delta_pct;
        const cardCls =
          def.id === "total_devices" ? "ops-card ops-card--kpi ops-card--kpi-priority" : "ops-card ops-card--kpi";
        return (
          <article key={def.id} className={cardCls}>
            <div className="ops-card__body">
              <div className="ops-kpi-label">
                {def.dot ? <span className={`ops-kpi-dot ops-kpi-dot--${def.dot}`} aria-hidden /> : null}
                {def.label}
              </div>
              <div className="ops-kpi-value-row">
                <div className="ops-kpi-value ops-kpi-value--count" key={String(v)}>
                  {v}
                </div>
                {spark.length ? <OverviewSparkline values={spark} accent={def.sparkAccent} /> : null}
              </div>
              {dPct != null && Math.abs(dPct) >= 0.5 && ex?.delta_label ? <DeltaLine pct={dPct} label={ex.delta_label} /> : null}
              {def.sub ? <div className="ops-kpi-sub">{def.sub}</div> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
