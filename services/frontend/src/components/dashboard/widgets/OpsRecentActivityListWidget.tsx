import { useEffect, useMemo, useState } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { formatRelativeAgo } from "@/lib/formatRelativeAgo";
import { OpsListPager } from "@/components/dashboard/widgets/OpsListPager";

type ActivityRow = {
  object_name?: string;
  event_type?: string;
  summary?: string;
  timestamp?: string | null;
};

export function OpsRecentActivityListWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const pageSize = Math.max(3, Math.min(Number(cfg.pageSize ?? cfg.page_size ?? 6), 12));
  const items = Array.isArray((block.data as { items?: ActivityRow[] } | undefined)?.items)
    ? ((block.data as { items: ActivityRow[] }).items ?? [])
    : [];
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [block.widget_id, items.length]);
  const slice = useMemo(() => {
    const p0 = Math.max(0, safePage - 1) * pageSize;
    return items.slice(p0, p0 + pageSize);
  }, [items, pageSize, safePage]);

  if (items.length === 0) {
    return (
      <DashboardWidgetFrame block={block} presentation={pres} state="empty" widgetKind="text" bodyFill>
        <p className="dash-wf__subtitle dash-ops-empty-msg">No recent activity</p>
      </DashboardWidgetFrame>
    );
  }

  return (
    <DashboardWidgetFrame block={block} presentation={pres} state="normal" widgetKind="text" bodyFill>
      <ul
        className="dash-ops-simple-list dash-ops-simple-list--tight dash-ops-simple-list--paged"
        aria-label="Recent activity"
      >
        {slice.map((row, i) => {
          const line =
            (row.summary && String(row.summary).trim()) ||
            [row.object_name, row.event_type].filter(Boolean).join(" — ") ||
            "—";
          return (
            <li
              key={`${row.timestamp ?? ""}-${line}-${i}`}
              className="dash-ops-simple-list__row dash-ops-simple-list__row--single"
            >
              <div className="dash-ops-simple-list__main">
                <div className="dash-ops-simple-list__title">{line}</div>
              </div>
              <div className="dash-ops-simple-list__ts">{formatRelativeAgo(row.timestamp)}</div>
            </li>
          );
        })}
      </ul>
      <OpsListPager
        page={safePage}
        totalPages={totalPages}
        totalItems={items.length}
        pageSize={pageSize}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        ariaLabel="Recent activity pages"
      />
    </DashboardWidgetFrame>
  );
}
