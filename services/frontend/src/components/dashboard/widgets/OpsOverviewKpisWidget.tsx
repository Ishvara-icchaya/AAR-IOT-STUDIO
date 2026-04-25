import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { AppIcon } from "@/lib/appIcons";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";
import "@/pages/device-register-page.css";

type KpiData = {
  total_devices?: number;
  online?: number;
  degraded?: number;
  offline?: number;
  last_data_relative?: string;
  last_device_name?: string | null;
};

export function OpsOverviewKpisWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const d = (block.data ?? {}) as KpiData;
  const subLast =
    d.last_device_name && d.last_data_relative && d.last_data_relative !== "—"
      ? `Latest: ${d.last_device_name} · ${d.last_data_relative}`
      : d.last_data_relative && d.last_data_relative !== "—"
        ? `Latest activity: ${d.last_data_relative}`
        : "No recent payloads";

  return (
    <DashboardWidgetFrame block={block} presentation={pres} state="normal" widgetKind="kpi-strip" bodyFill>
      <section className="dm-kpi-row dm-kpi-row--equal-5 dash-ops-kpi-inner" aria-label="Device summary">
        <div className="dm-kpi dm-kpi--with-deco">
          <div className="dm-kpi__body">
            <div className="dm-kpi__label">
              <AppIcon name="device" size="card" aria-hidden />
              Total devices
            </div>
            <div className="dm-kpi__value">{typeof d.total_devices === "number" ? d.total_devices : "—"}</div>
            <div className="dm-kpi__sub">In scope</div>
          </div>
        </div>
        <div className="dm-kpi dm-kpi--with-deco">
          <div className="dm-kpi__body">
            <div className="dm-kpi__label">
              <AppIcon name="online" size="card" aria-hidden />
              Online
            </div>
            <div className="dm-kpi__value">{typeof d.online === "number" ? d.online : "—"}</div>
          </div>
        </div>
        <div className="dm-kpi dm-kpi--with-deco">
          <div className="dm-kpi__body">
            <div className="dm-kpi__label">
              <AppIcon name="degraded" size="card" aria-hidden />
              Degraded
            </div>
            <div className="dm-kpi__value">{typeof d.degraded === "number" ? d.degraded : "—"}</div>
            <div className="dm-kpi__sub">Late or awaiting first payload</div>
          </div>
        </div>
        <div className="dm-kpi dm-kpi--with-deco">
          <div className="dm-kpi__body">
            <div className="dm-kpi__label">
              <AppIcon name="offline" size="card" aria-hidden />
              Offline
            </div>
            <div className="dm-kpi__value">{typeof d.offline === "number" ? d.offline : "—"}</div>
          </div>
        </div>
        <div className="dm-kpi dm-kpi--with-deco">
          <div className="dm-kpi__body">
            <div className="dm-kpi__label">
              <AppIcon name="refresh" size="card" aria-hidden />
              Last data received
            </div>
            <div className="dm-kpi__value">{d.last_data_relative ?? "—"}</div>
            <div className="dm-kpi__sub">{subLast}</div>
          </div>
        </div>
      </section>
    </DashboardWidgetFrame>
  );
}
