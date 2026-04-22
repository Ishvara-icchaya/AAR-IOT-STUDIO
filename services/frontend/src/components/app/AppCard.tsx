import type { CSSProperties, ReactNode } from "react";

export function AppCard({
  title,
  children,
  className,
  style,
  variant = "default",
  bodyClassName,
  headerExtra,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  variant?: "default" | "elevated";
  bodyClassName?: string;
  headerExtra?: ReactNode;
}) {
  const root = ["app-card", variant === "elevated" ? "app-card--elevated" : "", className].filter(Boolean).join(" ");
  const body = ["app-card__body", bodyClassName].filter(Boolean).join(" ");
  return (
    <div className={root} style={style}>
      {title != null ? (
        <div className="app-card__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
          <span>{title}</span>
          {headerExtra}
        </div>
      ) : null}
      <div className={body}>{children}</div>
    </div>
  );
}
