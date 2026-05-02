import { useCallback, useMemo, useState } from "react";
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

function severityRank(s: string): number {
  const x = s.toLowerCase();
  if (x === "critical") return 0;
  if (x === "warning") return 1;
  if (x === "info") return 2;
  return 3;
}

type SortKey = "time" | "severity";

const INCIDENTS_PAGE_SIZE = 10;

export function MonitoringIncidentTable({ items }: { items: MonitoringIncident[] }) {
  const { openDetail } = useAlertsModal();
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "time" ? "desc" : "asc");
      return key;
    });
  }, []);

  const sortedRows = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      if (sortKey === "time") {
        const ta = a.time ? new Date(a.time).getTime() : 0;
        const tb = b.time ? new Date(b.time).getTime() : 0;
        return sortDir === "asc" ? ta - tb : tb - ta;
      }
      const ra = severityRank(a.severity);
      const rb = severityRank(b.severity);
      if (ra !== rb) return sortDir === "asc" ? ra - rb : rb - ra;
      const ta = a.time ? new Date(a.time).getTime() : 0;
      const tb = b.time ? new Date(b.time).getTime() : 0;
      return tb - ta;
    });
    return copy;
  }, [items, sortKey, sortDir]);

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? <span className="dm-data-table__th-sort-ind">{sortDir === "asc" ? "▲" : "▼"}</span> : null;

  const columns = useMemo<PlainOperationalColumn<MonitoringIncident>[]>(() => {
    return [
      {
        id: "time",
        header: (
          <button
            type="button"
            className="dm-data-table__th-btn"
            onClick={() => toggleSort("time")}
            aria-label={
              sortKey === "time"
                ? `Time, sorted ${sortDir === "asc" ? "ascending" : "descending"}. Click to reverse.`
                : "Sort by time"
            }
          >
            Time
            {sortIndicator("time")}
          </button>
        ),
        cell: (r) => {
          const v = r.time;
          return v ? new Date(v).toLocaleString() : "—";
        },
      },
      { id: "component", header: "Component", cell: (r) => r.component },
      {
        id: "severity",
        header: (
          <button
            type="button"
            className="dm-data-table__th-btn"
            onClick={() => toggleSort("severity")}
            aria-label={
              sortKey === "severity"
                ? `Severity, sorted ${sortDir === "asc" ? "ascending" : "descending"}. Click to reverse.`
                : "Sort by severity"
            }
          >
            Severity
            {sortIndicator("severity")}
          </button>
        ),
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
  }, [openDetail, sortDir, sortKey, toggleSort]);

  return (
    <PlainOperationalTable<MonitoringIncident>
      rows={sortedRows}
      columns={columns}
      getRowId={(r) => r.alert_id}
      bordered={false}
      tableVariant="dm"
      pageSize={INCIDENTS_PAGE_SIZE}
      innerScroll={false}
      resetPageKey={`${sortKey}-${sortDir}-${items.length}`}
      pagerAriaLabel="Recent incidents pages"
      emptyMessage="No recent incidents in alert history."
    />
  );
}
