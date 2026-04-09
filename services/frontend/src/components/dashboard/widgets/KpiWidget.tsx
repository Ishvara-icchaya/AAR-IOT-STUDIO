import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { blinkModeClass, healthColorVar } from "@/lib/healthBlink";

export function KpiWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const d = block.data ?? {};
  const blink = blinkModeClass(d.blink_mode);
  const v = d.value;
  const metric = String(d.metric ?? "");
  return (
    <div className={`dash-widget dash-widget--kpi ${blink}`} style={{ borderLeft: `4px solid ${healthColorVar(d.health_status)}` }}>
      <h3 className="dash-widget__title">{block.title}</h3>
      <div className="dash-widget__kpi-value">{v === null || v === undefined ? "—" : String(v)}</div>
      {metric && <div className="dash-widget__muted">{metric}</div>}
    </div>
  );
}
