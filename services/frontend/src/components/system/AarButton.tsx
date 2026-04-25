import type { ButtonHTMLAttributes } from "react";

export type AarButtonVariant = "primary" | "outline" | "danger" | "warning";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AarButtonVariant;
};

const variantClass: Record<AarButtonVariant, string> = {
  primary: "dm-btn dm-btn--primary",
  outline: "dm-btn dm-btn--outline",
  danger: "dm-btn dm-btn--danger",
  warning: "dm-btn dm-btn--warning",
};

export function AarButton({ variant = "outline", className, type = "button", ...rest }: Props) {
  const base = variantClass[variant];
  return <button type={type} className={className ? `${base} ${className}` : base} {...rest} />;
}
