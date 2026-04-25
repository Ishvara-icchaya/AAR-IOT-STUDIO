import type { SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement>;

export function AarSelect({ className, ...rest }: Props) {
  return <select className={className ? `aar-select ${className}` : "aar-select"} {...rest} />;
}
