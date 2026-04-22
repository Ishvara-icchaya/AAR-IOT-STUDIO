import type { ReactNode } from "react";

export function AppDataTable({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["app-data-table-wrap", className].filter(Boolean).join(" ")}>
      <table className="app-data-table">{children}</table>
    </div>
  );
}
