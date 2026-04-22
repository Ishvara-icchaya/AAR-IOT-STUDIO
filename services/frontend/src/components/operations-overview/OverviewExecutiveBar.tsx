import type { CommandCenterPayload } from "./operationsOverviewCommandCenter";

function fmtInt(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

export function OverviewExecutiveBar({ cc }: { cc: CommandCenterPayload }) {
  const up = cc.system_uptime_pct;
  return (
    <div className="ops-exec-bar" aria-label="Business and reliability signals">
      <div className="ops-exec-bar__item">
        <span className="ops-exec-bar__label">Data processed (24h)</span>
        <span className="ops-exec-bar__value">{fmtInt(cc.data_volume_24h)}</span>
        <span className="ops-exec-bar__hint">objects + workflow results</span>
      </div>
      <div className="ops-exec-bar__item ops-exec-bar__item--right">
        <span className="ops-exec-bar__label">System uptime</span>
        <span className="ops-exec-bar__value">{up != null ? `${up.toFixed(2)}%` : "—"}</span>
        <span className="ops-exec-bar__hint">{up != null ? "SLA-style headline" : "Configure SLA source"}</span>
      </div>
    </div>
  );
}
