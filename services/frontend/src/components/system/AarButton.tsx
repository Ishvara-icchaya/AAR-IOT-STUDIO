import type { ButtonHTMLAttributes } from "react";

export type AarButtonVariant = "primary" | "outline" | "danger" | "warning";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AarButtonVariant;
};

const variantClass: Record<AarButtonVariant, string> = {
  primary: "aar-btn aar-btn--primary dm-btn dm-btn--primary",
  outline: "aar-btn aar-btn--outline dm-btn dm-btn--outline",
  danger: "aar-btn aar-btn--danger dm-btn dm-btn--danger",
  warning: "aar-btn aar-btn--warning dm-btn dm-btn--warning",
};

export function AarButton({ variant = "outline", className, type = "button", ...rest }: Props) {
  const base = variantClass[variant];
  return <button type={type} className={className ? `${base} ${className}` : base} {...rest} />;
}
