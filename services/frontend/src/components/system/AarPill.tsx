import type { HTMLAttributes, ReactNode } from "react";

export type AarPillTone = "neon" | "warn" | "muted" | "bad";

type Props = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  tone: AarPillTone;
  children: ReactNode;
};

export function AarPill({ tone, className, children, ...rest }: Props) {
  const cls = ["aar-pill", `aar-pill--${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
