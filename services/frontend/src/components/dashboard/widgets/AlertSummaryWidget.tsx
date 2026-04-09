import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { blinkModeClass } from "@/lib/healthBlink";

export function AlertSummaryWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const d = block.data ?? {};
  const blink = blinkModeClass(d.blink_mode);
  const by = (d.active_by_severity as Record<string, number>) || {};
  const recent = Array.isArray(d.recent) ? (d.recent as { title?: string; severity?: string; acknowledged?: boolean }[]) : [];
  const unack = Number(d.unacknowledged_count ?? 0);

  return (
    <div className={`dash-widget dash-widget--alerts ${blink}`}>
      <h3 className="dash-widget__title">{block.title}</h3>
      <p className="dash-widget__muted">Unacknowledged: {unack}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {Object.entries(by).map(([sev, n]) => (
          <span key={sev} style={{ padding: "0.2rem 0.5rem", background: "var(--color-surface-elevated)", borderRadius: 4 }}>
            {sev}: {n}
          </span>
        ))}
      </div>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem", maxHeight: 160, overflow: "auto" }}>
        {recent.slice(0, 10).map((a, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <span style={{ color: "var(--color-text-muted)" }}>{a.severity}</span> {a.title}
            {a.acknowledged ? " ✓" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
