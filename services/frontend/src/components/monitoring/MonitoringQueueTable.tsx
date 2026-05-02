import { useMemo } from "react";
import type { MonitoringQueueRow } from "@/types/monitoring";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

export function MonitoringQueueTable({
  rows,
  onView,
}: {
  rows: MonitoringQueueRow[];
  onView: (row: MonitoringQueueRow) => void;
}) {
  const columns = useMemo<PlainOperationalColumn<MonitoringQueueRow>[]>(() => {
    return [
      { id: "topic", header: "Topic", cell: (r) => r.topic },
      { id: "queue_type", header: "Type", cell: (r) => r.queue_type },
      { id: "messages", header: "Messages (log)", cell: (r) => String(r.messages ?? "—") },
      { id: "lag", header: "Lag", cell: (r) => String(r.lag ?? "—") },
      { id: "consumers", header: "Consumers (hb)", cell: (r) => String(r.consumers ?? "—") },
      {
        id: "last_event_at",
        header: "Last check",
        cell: (r) => {
          const v = r.last_event_at;
          return v ? new Date(v).toLocaleString() : "—";
        },
      },
      {
        id: "status",
        header: "Status",
        cell: (r) => <MonitoringStatusBadge status={r.status} />,
      },
      {
        id: "action",
        header: "Action",
        align: "left",
        cell: (r) => (
          <button
            type="button"
            onClick={() => onView(r)}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--color-accent)",
              cursor: "pointer",
              padding: 0,
              font: "inherit",
              textDecoration: "underline",
            }}
          >
            View
          </button>
        ),
      },
    ];
  }, [onView]);

  return (
    <PlainOperationalTable<MonitoringQueueRow>
      rows={rows}
      columns={columns}
      getRowId={(r) => r.topic}
      bordered={false}
      tableVariant="dm"
      emptyMessage="Kafka unreachable or no queue data."
    />
  );
}
