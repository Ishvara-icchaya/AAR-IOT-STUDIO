import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
};

export function OpsKpiRow({ children, ariaLabel = "Summary", className }: Props) {
  return (
    <section className={className ? `dm-kpi-row ${className}` : "dm-kpi-row"} aria-label={ariaLabel}>
      {children}
    </section>
  );
}
