import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement>;

export function AarInput({ className, ...rest }: Props) {
  return <input className={className ? `aar-input ${className}` : "aar-input"} {...rest} />;
}
