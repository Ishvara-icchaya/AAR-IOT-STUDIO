import { useEffect, useMemo, useState } from "react";
import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";
import { formatRelativeAgo } from "@/lib/formatRelativeAgo";
import { OpsListPager } from "@/components/dashboard/widgets/OpsListPager";
import { AppIcon } from "@/lib/appIcons";

type AlertRow = {
  severity?: string;
  title?: string;
  device_name?: string | null;
  site_name?: string | null;
  created_at?: string | null;
};

function severityClass(sev: string): string {
  const s = sev.trim().toLowerCase();
  if (s === "critical" || s === "error" || s === "fatal") return "dash-ops-sev dash-ops-sev--critical";
  if (s === "warning" || s === "warn") return "dash-ops-sev dash-ops-sev--warn";
  if (s === "info" || s === "informational") return "dash-ops-sev dash-ops-sev--info";
  if (s === "low" || s === "debug") return "dash-ops-sev dash-ops-sev--low";
  return "dash-ops-sev dash-ops-sev--muted";
}

function severityIconName(sev: string) {
  const s = sev.trim().toLowerCase();
  if (s === "critical" || s === "error" || s === "fatal") return "offline";
  if (s === "warning" || s === "warn") return "degraded";
  if (s === "info" || s === "informational") return "online";
  return "alert";
}

function locationLine(row: AlertRow): string {
  const parts: string[] = [];
  if (row.device_name) parts.push(row.device_name);
  if (row.site_name) parts.push(row.site_name);
  return parts.length ? parts.join(" · ") : "—";
}

export function OpsRecentAlertsWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const pageSize = Math.max(3, Math.min(Number(cfg.pageSize ?? cfg.page_size ?? 6), 12));
  const items = Array.isArray((block.data as { items?: AlertRow[] } | undefined)?.items)
    ? ((block.data as { items: AlertRow[] }).items ?? [])
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
        <p className="dash-wf__subtitle dash-ops-empty-msg">No recent alerts</p>
      </DashboardWidgetFrame>
    );
  }

  return (
    <DashboardWidgetFrame block={block} presentation={pres} state="normal" widgetKind="text" bodyFill>
      <ul className="dash-ops-simple-list dash-ops-simple-list--tight dash-ops-simple-list--paged" aria-label="Recent alerts">
        {slice.map((row, i) => {
          const sev = String(row.severity ?? "");
          const headline = (row.title && String(row.title).trim()) || "Alert";
          return (
            <li key={`${row.created_at ?? ""}-${headline}-${i}`} className="dash-ops-simple-list__row">
              <div className="dash-ops-simple-list__main">
                <div className="dash-ops-simple-list__title">
                  <span className={severityClass(sev)} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                    <AppIcon name={severityIconName(sev)} size="table" aria-hidden />
                    {sev || "—"}
                  </span>
                  {headline}
                </div>
                <div className="dash-ops-simple-list__meta">{locationLine(row)}</div>
              </div>
              <div className="dash-ops-simple-list__ts">{formatRelativeAgo(row.created_at)}</div>
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
        ariaLabel="Recent alerts pages"
      />
    </DashboardWidgetFrame>
  );
}
