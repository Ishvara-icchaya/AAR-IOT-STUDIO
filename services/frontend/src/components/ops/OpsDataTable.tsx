import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  id?: string;
  className?: string;
};

export function OpsDataTable({ children, id, className }: Props) {
  return (
    <div className={className ? `dm-table-wrap ${className}` : "dm-table-wrap"} id={id}>
      {children}
    </div>
  );
}
