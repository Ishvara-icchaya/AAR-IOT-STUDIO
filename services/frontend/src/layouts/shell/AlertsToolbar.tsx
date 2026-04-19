import { useAlertsModal } from "@/contexts/AlertsModalContext";

type AlertTone = "none" | "critical" | "warning" | "info";

export function AlertsToolbar({
  unacked,
  alertTone,
}: {
  unacked: number;
  alertTone: AlertTone;
}) {
  const { openList } = useAlertsModal();

  return (
    <button
      type="button"
      className={`shell__alert-link${
        alertTone === "critical"
          ? " shell__alert-link--critical"
          : alertTone === "warning"
            ? " shell__alert-link--warning"
            : alertTone === "info"
              ? " shell__alert-link--info"
              : ""
      }`}
      title="Unified alerts"
      aria-label="Open alerts"
      onClick={() => openList()}
    >
      <span aria-hidden>🔔</span>
      <span>Alerts</span>
      {unacked > 0 ? (
        <span
          className={alertTone === "critical" || alertTone === "warning" ? "shell__alert-badge--pulse" : undefined}
          style={{
            background:
              alertTone === "critical"
                ? "#c62828"
                : alertTone === "warning"
                  ? "#f9a825"
                  : alertTone === "info"
                    ? "#1565c0"
                    : "var(--color-accent)",
            color: "var(--btn-on-accent)",
            borderRadius: "10px",
            padding: "0.05rem 0.4rem",
            fontSize: "0.72rem",
            fontWeight: 700,
          }}
        >
          {unacked > 99 ? "99+" : unacked}
        </span>
      ) : null}
    </button>
  );
}
