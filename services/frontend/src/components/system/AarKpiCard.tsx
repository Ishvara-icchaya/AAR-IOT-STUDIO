import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement>;

export function AarKpiCard({ className, ...rest }: Props) {
  return <div className={className ? `aar-kpi-card ${className}` : "aar-kpi-card"} {...rest} />;
}
