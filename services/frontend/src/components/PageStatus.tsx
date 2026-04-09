import type { ReactNode } from "react";

export type PageStatusVariant = "error" | "warning" | "success" | "info";

const GLYPH: Record<PageStatusVariant, string> = {
  error: "✕",
  warning: "⚠",
  success: "✓",
  info: "ℹ",
};

type Props = {
  variant: PageStatusVariant;
  children: ReactNode;
  /** When true, prepends a compact symbol (decorative; not a substitute for accessible text). */
  icon?: boolean;
  className?: string;
};

/** Local page-level status (errors, warnings, success, info) — use inside `PageShell` / feature pages. */
export function PageStatus({ variant, children, icon = false, className }: Props) {
  const role = variant === "error" ? "alert" : "status";
  return (
    <div
      role={role}
      className={["page-status", `page-status--${variant}`, className].filter(Boolean).join(" ")}
    >
      {icon ? (
        <span className="page-status__glyph" aria-hidden>
          {GLYPH[variant]}
        </span>
      ) : null}
      <div className="page-status__body">{children}</div>
    </div>
  );
}
