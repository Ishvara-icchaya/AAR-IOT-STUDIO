import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone?: "default" | "plain" | "danger";
};

export function OpsActionButton({ children, tone = "default", className, ...rest }: Props) {
  const toneClass =
    tone === "danger" ? "dm-act-grid__btn dm-act-grid__btn--danger" : tone === "plain" ? "dm-act-grid__btn dm-act-grid__btn--plain" : "dm-act-grid__btn";
  return (
    <button type="button" className={className ? `${toneClass} ${className}` : toneClass} {...rest}>
      {children}
    </button>
  );
}
