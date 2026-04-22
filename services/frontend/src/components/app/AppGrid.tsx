import type { ReactNode } from "react";

export function AppGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 1 | 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  const col =
    columns === 1 ? "app-grid--1" : columns === 2 ? "app-grid--2" : columns === 3 ? "app-grid--3" : "app-grid--4";
  return <div className={["app-grid", col, className].filter(Boolean).join(" ")}>{children}</div>;
}
