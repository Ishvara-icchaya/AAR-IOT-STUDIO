import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { adaptDeviceTileWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { formatDashboardValue, resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { blinkModeClass, healthColorVar } from "@/lib/healthBlink";

function formatTs(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleString();
}

export function DeviceTileWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const vm = adaptDeviceTileWidget(block);
  const blink = blinkModeClass(vm.blinkMode);
  const kpis = vm.kpis;
  const name = vm.deviceName || block.title;
  const icon = vm.deviceIcon;
  const health = vm.healthStatus;
  const hc = healthColorVar(vm.healthStatus);
  const updated = formatTs(vm.updatedAt);

  const sourceLine =
    pres.showSource && vm.sourceId ? `Source ${vm.sourceId.slice(0, 8)}…` : null;

  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state="normal"
      widgetKind="device"
      className={blink}
      rootStyle={{
        borderColor: hc,
        borderWidth: 2,
        borderStyle: "solid",
        borderRadius: "var(--radius-lg)",
      }}
      sourceLine={sourceLine}
      updatedAtLine={pres.showUpdatedAt && updated ? `Updated ${updated}` : null}
      subtitle={
        <div className="dash-wf-device__health">
          <span className="dash-wf-device__health-label">Health</span>
          <span className="dash-wf-device__badge" style={{ borderColor: hc, color: hc }}>
            {health}
          </span>
        </div>
      }
    >
      <div className="dash-wf-device__head">
        {icon ? <span className="dash-wf-device__icon" aria-hidden>{icon}</span> : null}
        <span className="dash-wf-device__name">{name}</span>
      </div>
      {vm.healthMessage ? (
        <p className="dash-widget__muted dash-wf-device__msg">{vm.healthMessage}</p>
      ) : null}
      <dl className="dash-wf-device__fields">
        {Object.entries(kpis).map(([k, v]) => (
          <div key={k} className="dash-wf-device__row">
            <dt>{k}</dt>
            <dd>{formatDashboardValue(v, pres)}</dd>
          </div>
        ))}
      </dl>
    </DashboardWidgetFrame>
  );
}
