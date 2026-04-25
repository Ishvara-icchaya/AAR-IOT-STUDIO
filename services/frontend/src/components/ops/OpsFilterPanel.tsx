import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  ariaLabel?: string;
};

export function OpsFilterPanel({ children, ariaLabel = "Filters" }: Props) {
  return (
    <section className="dm-filter-panel" aria-label={ariaLabel}>
      {children}
    </section>
  );
}
