import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { blinkModeClass, healthColorVar } from "@/lib/healthBlink";

export function DeviceTileWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const d = block.data ?? {};
  const blink = blinkModeClass(d.blink_mode);
  const kpis = (d.kpis as Record<string, unknown>) || {};
  const name = String(d.device_name ?? d.display_name ?? block.title);
  const icon = d.device_icon ? String(d.device_icon) : null;

  return (
    <div
      className={`dash-widget dash-widget--device ${blink}`}
      style={{ borderColor: healthColorVar(d.health_status), borderWidth: 2, borderStyle: "solid", borderRadius: "var(--radius)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        {icon && <span style={{ fontSize: "1.5rem" }}>{icon}</span>}
        <h3 className="dash-widget__title" style={{ margin: 0 }}>
          {name}
        </h3>
      </div>
      <div className="dash-widget__muted" style={{ marginBottom: "0.35rem" }}>
        Health: <strong style={{ color: healthColorVar(d.health_status) }}>{String(d.health_status ?? "—")}</strong>
      </div>
      <dl style={{ margin: 0, display: "grid", gap: "0.25rem", fontSize: "0.85rem" }}>
        {Object.entries(kpis).map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
            <dt style={{ color: "var(--color-text-muted)" }}>{k}</dt>
            <dd style={{ margin: 0 }}>{v === null || v === undefined ? "—" : String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
