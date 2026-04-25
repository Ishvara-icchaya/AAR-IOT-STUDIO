import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "plain" | "danger";
};

export function AarIconButton({ tone = "default", className, type = "button", ...rest }: Props) {
  const toneClass =
    tone === "danger" ? "dm-act-grid__btn dm-act-grid__btn--danger" : tone === "plain" ? "dm-act-grid__btn dm-act-grid__btn--plain" : "dm-act-grid__btn";
  return <button type={type} className={className ? `${toneClass} ${className}` : toneClass} {...rest} />;
}
