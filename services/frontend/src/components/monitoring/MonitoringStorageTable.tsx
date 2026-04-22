import { useMemo } from "react";
import type { MonitoringStorageRow } from "@/api/monitoring";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

export function MonitoringStorageTable({ rows }: { rows: MonitoringStorageRow[] }) {
  const columns = useMemo<PlainOperationalColumn<MonitoringStorageRow>[]>(() => {
    return [
      { id: "storage_layer", header: "Layer", cell: (r) => r.storage_layer },
      {
        id: "status",
        header: "Status",
        cell: (r) => <MonitoringStatusBadge status={r.status} />,
      },
      { id: "used_gb", header: "Used GB", cell: (r) => String(r.used_gb ?? "—") },
      { id: "capacity_gb", header: "Capacity GB", cell: (r) => String(r.capacity_gb ?? "—") },
      {
        id: "last_check",
        header: "Last check",
        cell: (r) => {
          const v = r.last_check;
          return v ? new Date(v).toLocaleString() : "—";
        },
      },
      { id: "notes", header: "Notes", cell: (r) => String(r.notes ?? "—") },
    ];
  }, []);

  return (
    <div className="table-scroll-sticky" style={{ overflow: "auto", borderRadius: "var(--radius)" }}>
      <PlainOperationalTable<MonitoringStorageRow>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.storage_layer}
        bordered
      />
    </div>
  );
}
