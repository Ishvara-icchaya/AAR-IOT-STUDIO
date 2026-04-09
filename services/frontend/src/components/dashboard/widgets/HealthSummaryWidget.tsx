import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { healthColorVar } from "@/lib/healthBlink";

export function HealthSummaryWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const counts = (block.data?.counts as Record<string, number>) || {};
  const order = ["green", "yellow", "red", "offline"] as const;
  return (
    <div className="dash-widget dash-widget--health-summary">
      <h3 className="dash-widget__title">{block.title}</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        {order.map((k) => (
          <div
            key={k}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "var(--radius)",
              border: `2px solid ${healthColorVar(k)}`,
              minWidth: "5rem",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "capitalize" }}>{k}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{counts[k] ?? 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
