import { useMemo } from "react";
import type { MonitoringResourceRow } from "@/api/monitoring";
import { PlainOperationalTable, type PlainOperationalColumn } from "@/components/data/PlainOperationalTable";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

export function MonitoringResourcesTable({ rows }: { rows: MonitoringResourceRow[] }) {
  const columns = useMemo<PlainOperationalColumn<MonitoringResourceRow>[]>(() => {
    return [
      { id: "component", header: "Component", cell: (r) => r.component },
      { id: "cpu_percent", header: "CPU %", cell: (r) => String(r.cpu_percent ?? "—") },
      { id: "memory_mb", header: "Memory MB", cell: (r) => String(r.memory_mb ?? "—") },
      { id: "disk_io_mb_s", header: "Disk I/O MB/s", cell: (r) => String(r.disk_io_mb_s ?? "—") },
      { id: "network_io_mb_s", header: "Net I/O MB/s", cell: (r) => String(r.network_io_mb_s ?? "—") },
      {
        id: "status",
        header: "Status",
        cell: (r) => <MonitoringStatusBadge status={r.status} />,
      },
    ];
  }, []);

  return (
    <div className="dm-table-scroll">
      <PlainOperationalTable<MonitoringResourceRow>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.component}
        bordered={false}
        emptyMessage="No resource metrics reported."
      />
    </div>
  );
}
