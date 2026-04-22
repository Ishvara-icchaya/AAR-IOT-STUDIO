/** Status cell chrome aligned with Manage Devices (metric wrap + status line + dot). */
export type DmTableStatusTone = "online" | "degraded" | "offline" | "error" | "muted";

type Props = {
  label: string;
  tone: DmTableStatusTone;
};

export function DmTableStatusMetric({ label, tone }: Props) {
  return (
    <div className={`dm-metric-wrap dm-metric-wrap--tone-${tone}`}>
      <span className={`dm-status-line dm-status-line--${tone}`} style={{ textTransform: "capitalize" }}>
        <span className={`dm-status-dot dm-status-dot--${tone}`} aria-hidden />
        {label}
      </span>
    </div>
  );
}
