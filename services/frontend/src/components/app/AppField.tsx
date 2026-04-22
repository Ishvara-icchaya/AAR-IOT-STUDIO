import type { ReactNode } from "react";

export function AppField({
  label,
  hint,
  children,
  className,
  size = "md",
  htmlFor,
  as: FieldTag = "label",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  size?: "md" | "sm";
  htmlFor?: string;
  /** Use `div` when the field contains non-phrasing content (e.g. help paragraphs in-grid). */
  as?: "label" | "div";
}) {
  const root = ["app-field", size === "sm" ? "app-field--tight" : "", className].filter(Boolean).join(" ");
  return (
    <FieldTag className={root} htmlFor={FieldTag === "label" ? htmlFor : undefined}>
      <span className="app-field__label">{label}</span>
      {children}
      {hint ? (
        typeof hint === "string" ? (
          <p className="app-field__hint">{hint}</p>
        ) : (
          <div className="app-field__hint">{hint}</div>
        )
      ) : null}
    </FieldTag>
  );
}

/** Non-label field wrapper (e.g. for checkboxes). */
export function AppFieldGroup({
  label,
  hint,
  children,
  className,
  size = "md",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  size?: "md" | "sm";
}) {
  const root = ["app-field", size === "sm" ? "app-field--tight" : "", className].filter(Boolean).join(" ");
  return (
    <div className={root}>
      <span className="app-field__label">{label}</span>
      {children}
      {hint ? <p className="app-field__hint">{hint}</p> : null}
    </div>
  );
}
