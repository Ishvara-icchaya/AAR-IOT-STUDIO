import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "icon" | "iconPrimary";

export function AppButton({
  variant = "primary",
  block,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  block?: boolean;
}) {
  const cls = [
    "app-btn",
    variant === "primary" && "app-btn--primary",
    variant === "secondary" && "app-btn--secondary",
    variant === "ghost" && "app-btn--ghost",
    variant === "icon" && "app-btn--icon",
    variant === "iconPrimary" && "app-btn--icon app-btn--icon-primary",
    block && "app-btn--block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

/** Same styles as AppButton for `<a>` / router Link. */
export function appButtonClassName(variant: Variant = "primary", extra?: string): string {
  return [
    "app-btn",
    variant === "primary" && "app-btn--primary",
    variant === "secondary" && "app-btn--secondary",
    variant === "ghost" && "app-btn--ghost",
    variant === "icon" && "app-btn--icon",
    variant === "iconPrimary" && "app-btn--icon app-btn--icon-primary",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}
