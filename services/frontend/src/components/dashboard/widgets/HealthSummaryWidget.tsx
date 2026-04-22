import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { adaptHealthSummaryWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { healthColorVar } from "@/lib/healthBlink";

export function HealthSummaryWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const vm = adaptHealthSummaryWidget(block);
  const counts = vm.counts;
  const order = ["green", "yellow", "red", "offline"] as const;

  return (
    <DashboardWidgetFrame block={block} presentation={pres} state="normal" widgetKind="health-summary">
      <div className="dash-wf-health__grid">
        {order.map((k) => (
          <div key={k} className="dash-wf-health__cell" style={{ borderColor: healthColorVar(k) }}>
            <div className="dash-wf-health__label">{k}</div>
            <div className="dash-wf-health__value">{counts[k] ?? 0}</div>
          </div>
        ))}
      </div>
    </DashboardWidgetFrame>
  );
}
