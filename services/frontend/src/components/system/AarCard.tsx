import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement>;

export function AarCard({ className, ...rest }: Props) {
  return <div className={className ? `aar-card ${className}` : "aar-card"} {...rest} />;
}
