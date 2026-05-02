import { ChevronRight } from "lucide-react";
import { useAlertsModal } from "@/contexts/AlertsModalContext";
import { AarButton } from "@/components/system/AarButton";

export function MonitoringAlertsStrip() {
  const { openList } = useAlertsModal();

  return (
    <div className="dm-filter-panel monitoring-alerts-strip" style={{ marginBottom: "0.75rem" }}>
      <div className="dm-controls-form__row monitoring-alerts-strip__row" style={{ alignItems: "center" }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--dm-text)" }}>
          Alerts &amp; notifications
        </span>
        <span style={{ fontSize: "0.78rem", color: "var(--dm-muted)", flex: "1 1 12rem", minWidth: 0 }}>
          Open incidents, routing, and delivery status in the unified alerts hub.
        </span>
        <AarButton
          type="button"
          variant="outline"
          className="monitoring-alerts-strip__cta"
          style={{ marginLeft: "auto" }}
          onClick={() => openList()}
        >
          Open alerts
          <ChevronRight size={16} strokeWidth={2} aria-hidden />
        </AarButton>
      </div>
    </div>
  );
}
