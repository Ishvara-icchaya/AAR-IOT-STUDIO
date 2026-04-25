import type { HTMLAttributes } from "react";

/** Wraps the canonical ops table chrome (`dm-table-wrap`). */
type Props = HTMLAttributes<HTMLDivElement>;

export function AarDataTableShell({ className, ...rest }: Props) {
  return <div className={className ? `dm-table-wrap ${className}` : "dm-table-wrap"} {...rest} />;
}
