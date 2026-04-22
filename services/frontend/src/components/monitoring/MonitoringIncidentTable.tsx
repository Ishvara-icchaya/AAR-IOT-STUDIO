import { useMemo } from "react";
import { useAlertsModal } from "@/contexts/AlertsModalContext";
import type { MonitoringIncident } from "@/types/monitoring";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";

function sevColor(s: string) {
  const x = s.toLowerCase();
  if (x === "critical") return "#c62828";
  if (x === "warning") return "#f9a825";
  if (x === "info") return "#64b5f6";
  return "var(--color-text-muted)";
}

export function MonitoringIncidentTable({ items }: { items: MonitoringIncident[] }) {
  const { openDetail } = useAlertsModal();

  const columns = useMemo<PlainOperationalColumn<MonitoringIncident>[]>(() => {
    return [
      {
        id: "time",
        header: "Time",
        cell: (r) => {
          const v = r.time;
          return v ? new Date(v).toLocaleString() : "—";
        },
      },
      { id: "component", header: "Component", cell: (r) => r.component },
      {
        id: "severity",
        header: "Severity",
        cell: (r) => (
          <span style={{ color: sevColor(r.severity), fontWeight: 600 }}>{r.severity}</span>
        ),
      },
      { id: "message", header: "Message", cell: (r) => r.message },
      {
        id: "action",
        header: "Action",
        cell: (r) => (
          <button
            type="button"
            onClick={() => openDetail(r.alert_id)}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              color: "var(--color-accent)",
              cursor: "pointer",
              font: "inherit",
              textDecoration: "underline",
            }}
          >
            View
          </button>
        ),
      },
    ];
  }, [openDetail]);

  return (
    <div className="table-scroll-sticky" style={{ overflow: "auto" }}>
      <PlainOperationalTable<MonitoringIncident>
        rows={items}
        columns={columns}
        getRowId={(r) => r.alert_id}
        bordered
        emptyMessage="No recent incidents in alert history."
      />
    </div>
  );
}
