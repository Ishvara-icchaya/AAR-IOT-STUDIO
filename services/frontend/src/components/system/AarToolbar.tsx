import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement>;

export function AarToolbar({ className, ...rest }: Props) {
  return <div className={className ? `aar-toolbar ${className}` : "aar-toolbar"} {...rest} />;
}
