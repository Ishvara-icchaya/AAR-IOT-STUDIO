import type { ReactNode } from "react";

export function AppBadge({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: "default" | "accent" | "success" | "warning" | "error";
  className?: string;
}) {
  const cls = [
    "app-badge",
    variant === "accent" && "app-badge--accent",
    variant === "success" && "app-badge--success",
    variant === "warning" && "app-badge--warning",
    variant === "error" && "app-badge--error",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={cls}>{children}</span>;
}
