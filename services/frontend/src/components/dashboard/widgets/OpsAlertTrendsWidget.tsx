import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";

type DayBucket = { label?: string; warning?: number; critical?: number };

function maxVal(series: DayBucket[]) {
  return Math.max(1, ...series.map((d) => (Number(d.warning) || 0) + (Number(d.critical) || 0)));
}

export function OpsAlertTrendsWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const series = Array.isArray((block.data as { series?: DayBucket[] } | undefined)?.series)
    ? ((block.data as { series: DayBucket[] }).series ?? [])
    : [];
  const mx = maxVal(series);

  if (series.length === 0) {
    return (
      <DashboardWidgetFrame block={block} presentation={pres} state="empty" widgetKind="text" bodyFill>
        <p className="dash-wf__subtitle dash-ops-empty-msg">No alert trend data in this range</p>
      </DashboardWidgetFrame>
    );
  }

  return (
    <DashboardWidgetFrame block={block} presentation={pres} state="normal" widgetKind="chart" bodyFill>
      <div className="dash-ops-trends" aria-label="Alert severity trend">
        <div className="dash-ops-trends__legend">
          <span className="dash-ops-trends__lg dash-ops-trends__lg--warn">Warning</span>
          <span className="dash-ops-trends__lg dash-ops-trends__lg--crit">Critical</span>
        </div>
        <div className="dash-ops-trends__chart" role="img">
          {series.map((d, i) => {
            const w = Number(d.warning) || 0;
            const c = Number(d.critical) || 0;
            const total = w + c;
            const stackH = Math.round((total / mx) * 100);
            const title = `${d.label ?? ""}: ${w} warning, ${c} critical`;
            return (
              <div key={`${d.label ?? i}`} className="dash-ops-trends__col">
                <div className="dash-ops-trends__col-chart">
                  {total === 0 ? (
                    <div className="dash-ops-trends__stack dash-ops-trends__stack--zero" title={title} />
                  ) : (
                    <div className="dash-ops-trends__stack" style={{ height: `${stackH}%` }} title={title}>
                      {w > 0 ? (
                        <div className="dash-ops-trends__seg dash-ops-trends__seg--warn" style={{ flex: w }} />
                      ) : null}
                      {c > 0 ? (
                        <div className="dash-ops-trends__seg dash-ops-trends__seg--crit" style={{ flex: c }} />
                      ) : null}
                    </div>
                  )}
                </div>
                <div className="dash-ops-trends__x">{d.label ?? ""}</div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardWidgetFrame>
  );
}
