import type { CSSProperties } from "react";
import { MonitoringStatusBadge } from "./MonitoringStatusBadge";

type Props = {
  title: string;
  status: string;
  subtitle?: string | null;
};

const card: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: "0.75rem 1rem",
  minWidth: "140px",
  flex: "1 1 140px",
};

export function MonitoringMetricCard({ title, status, subtitle }: Props) {
  return (
    <div style={card}>
      <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>{title}</div>
      <MonitoringStatusBadge status={status} />
      {subtitle ? (
        <div style={{ fontSize: "0.75rem", marginTop: "0.35rem", color: "var(--color-text-muted)" }}>{subtitle}</div>
      ) : null}
    </div>
  );
}
