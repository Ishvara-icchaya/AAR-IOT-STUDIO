import type { ReactNode } from "react";

export function AppEmptyState({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["app-empty-state", className].filter(Boolean).join(" ")}>
      {title ? <h2 className="app-empty-state__title">{title}</h2> : null}
      <div className="app-empty-state__body">{children}</div>
    </div>
  );
}
