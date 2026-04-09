import type { CSSProperties } from "react";

const colors: Record<string, string> = {
  healthy: "#2e7d32",
  warning: "#f9a825",
  critical: "#c62828",
  unknown: "var(--color-text-muted)",
};

export function MonitoringStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const c = colors[s] ?? colors.unknown;
  const style: CSSProperties = {
    display: "inline-block",
    padding: "0.15rem 0.5rem",
    borderRadius: "var(--radius)",
    fontSize: "0.75rem",
    fontWeight: 600,
    background: `${c}22`,
    color: c,
    textTransform: "capitalize",
  };
  return <span style={style}>{status}</span>;
}
