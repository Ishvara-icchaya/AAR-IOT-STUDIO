import { useAlertsModal } from "@/contexts/AlertsModalContext";

export function MonitoringAlertsStrip() {
  const { openList } = useAlertsModal();

  return (
    <div className="monitoring-alerts-strip">
      <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text)" }}>Alerts & notifications</span>
      <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
        Open incidents, routing, and delivery status in the unified alerts hub.
      </span>
      <button
        type="button"
        onClick={() => openList()}
        style={{
          marginLeft: "auto",
          padding: "0.35rem 0.85rem",
          borderRadius: "var(--radius)",
          border: "1px solid color-mix(in oklab, var(--color-accent) 40%, var(--color-border))",
          background: "color-mix(in oklab, var(--color-accent) 12%, transparent)",
          color: "var(--color-text)",
          fontSize: "0.8rem",
          fontWeight: 600,
          textDecoration: "none",
          transition: "transform 0.15s ease",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Open alerts →
      </button>
    </div>
  );
}
