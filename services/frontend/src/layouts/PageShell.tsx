import type { CSSProperties, ReactNode } from "react";

/**
 * Standard feature page layout: `page-card` + title row (+ optional actions) + body.
 * Use for routed feature pages so shell/title behavior stays consistent (not a route stub).
 */
export function PageShell({
  title,
  children,
  className,
  style,
  actions,
}: {
  title: string;
  children?: ReactNode;
  /** Appended to `page-card` (e.g. `dash-live-page`). */
  className?: string;
  style?: CSSProperties;
  /** Shown on the same row as the title (e.g. primary CTA, refresh). */
  actions?: ReactNode;
}) {
  const rootClass = ["page-card", className].filter(Boolean).join(" ");
  return (
    <div className={rootClass} style={style}>
      {actions != null ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <h1 style={{ margin: 0 }}>{title}</h1>
          <div className="page-shell__actions" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
            {actions}
          </div>
        </div>
      ) : (
        <h1>{title}</h1>
      )}
      {children}
    </div>
  );
}
