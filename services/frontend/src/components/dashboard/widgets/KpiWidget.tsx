import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { adaptKpiWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { formatDashboardValue, resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { blinkModeClass, healthColorVar } from "@/lib/healthBlink";

function formatTs(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleString();
}

export function KpiWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const vm = adaptKpiWidget(block);
  const blink = blinkModeClass(vm.blinkMode);
  const v = vm.value;
  const metric = vm.metric;
  const deviceName = vm.deviceName;
  const updated = formatTs(vm.updatedAt);
  const accent = healthColorVar(vm.healthStatus ?? undefined);

  const parts: string[] = [];
  if (pres.showSource && metric) parts.push(`Metric: ${metric}`);
  if (pres.showSource && deviceName) parts.push(`Device: ${deviceName}`);
  const sourceLine = parts.length ? parts.join(" · ") : null;

  const display =
    v === null || v === undefined ? "—" : formatDashboardValue(v, { decimalPlaces: pres.decimalPlaces, unit: pres.unit });

  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state="normal"
      widgetKind="kpi"
      className={blink}
      accentBorderColor={accent}
      accentBorderWidth={4}
      sourceLine={sourceLine}
      updatedAtLine={pres.showUpdatedAt && updated ? `Updated ${updated}` : null}
      bodyFill={false}
    >
      <div className="dash-wf-kpi__main">
        <div className="dash-widget__kpi-value">{display}</div>
        {!pres.showSource && (metric || deviceName) ? (
          <div className="dash-widget__kpi-meta">
            {metric ? (
              <div className="dash-widget__muted">
                <em>{metric}</em>
              </div>
            ) : null}
            {deviceName ? (
              <div className="dash-widget__muted">
                <em>{deviceName}</em>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </DashboardWidgetFrame>
  );
}
