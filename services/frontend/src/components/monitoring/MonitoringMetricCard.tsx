import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

type Props = {
  title: string;
  status: string;
  subtitle?: string | null;
};

/** Maps free-form status strings to KPI deco accent (device-register-page.css). */
export function monitoringKpiDecoFromStatus(status: string): "online" | "warn" | "offline" | "error" | "muted" {
  const s = status.toLowerCase();
  if (s.includes("health") || s === "ok" || s === "up" || s === "running") return "online";
  if (s.includes("warn") || s.includes("degraded")) return "warn";
  if (s.includes("down") || s.includes("offline")) return "offline";
  if (s.includes("error") || s.includes("fail") || s.includes("crit")) return "error";
  return "muted";
}

export function MonitoringMetricCard({ title, status, subtitle }: Props) {
  const deco = monitoringKpiDecoFromStatus(status);
  return (
    <div className="dm-kpi dm-kpi--with-deco">
      <div className="dm-kpi__body">
        <div className="dm-kpi__label">{title}</div>
        <div className="dm-kpi__value monitoring-metric-card__value">
          <MonitoringStatusBadge status={status} />
        </div>
        {subtitle ? <div className="dm-kpi__sub">{subtitle}</div> : null}
      </div>
      <div className={`dm-kpi__deco dm-kpi__deco--${deco}`} aria-hidden>
        {deco === "muted" ? (
          <span className="dm-kpi-dot" style={{ background: "var(--dm-muted)", opacity: 0.55 }} />
        ) : (
          <span className={`dm-kpi-dot dm-kpi-dot--${deco}`} />
        )}
      </div>
    </div>
  );
}
