import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { adaptAlertSummaryWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { blinkModeClass } from "@/lib/healthBlink";

export function AlertSummaryWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const vm = adaptAlertSummaryWidget(block);
  const blink = blinkModeClass(vm.blinkMode);
  const by = vm.activeBySeverity;
  const recent = vm.recent;
  const unack = vm.unacknowledgedCount;

  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state="normal"
      widgetKind="alerts"
      className={blink}
      bodyFill
      subtitle={<span className="dash-wf-alerts__unack">Unacknowledged: {unack}</span>}
    >
      <div className="dash-wf-alerts__chips">
        {Object.entries(by).map(([sev, n]) => (
          <span key={sev} className="dash-wf-alerts__chip">
            <span className="dash-wf-alerts__chip-sev">{sev}</span>
            <span className="dash-wf-alerts__chip-n">{n}</span>
          </span>
        ))}
      </div>
      <ul className="dash-widget__alerts-list dash-wf-alerts__list">
        {recent.slice(0, 10).map((a, i) => (
          <li key={i}>
            <span className="dash-wf-alerts__sev">{a.severity}</span>{" "}
            <span className="dash-wf-alerts__title">{a.title}</span>
            {a.acknowledged ? <span className="dash-wf-alerts__ack"> ✓</span> : null}
          </li>
        ))}
      </ul>
    </DashboardWidgetFrame>
  );
}
