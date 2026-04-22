import type { ReactNode } from "react";

export function AppToolbar({
  left,
  right,
  children,
  variant = "default",
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  variant?: "default" | "flat";
  className?: string;
}) {
  const root = ["app-toolbar", variant === "flat" ? "app-toolbar--flat" : "", className].filter(Boolean).join(" ");
  if (children) {
    return <div className={root}>{children}</div>;
  }
  return (
    <div className={root}>
      {left ? <div className="app-toolbar__left">{left}</div> : null}
      {right ? <div className="app-toolbar__right">{right}</div> : null}
    </div>
  );
}
