import type { CSSProperties, ReactNode } from "react";

/**
 * Standard feature page layout: optional actions row + body. The platform shell page bar
 * (`shell__page-title`) is the single page title — no duplicate H1 here unless `hideTitle={false}`.
 */
export function PageShell({
  title = "",
  children,
  className,
  style,
  actions,
  variant = "ops",
  /** Default true: omit the in-card H1 (page bar shows `titleFromPath`). Set false only for special cases. */
  hideTitle = true,
}: {
  title?: string;
  children?: ReactNode;
  /** Appended to `page-card` (e.g. `dash-live-page`). */
  className?: string;
  style?: CSSProperties;
  /** Shown on the same row as the title (e.g. primary CTA, refresh). */
  actions?: ReactNode;
  /** `ops` = dark glow card. `plain` = flat card. `list` = dense list/index (minimal chrome). */
  variant?: "ops" | "plain" | "list";
  hideTitle?: boolean;
}) {
  const variantClass =
    variant === "list" ? "page-card--list" : variant === "ops" ? "page-card--ops-glow" : "";
  const rootClass = ["page-card", variantClass, className].filter(Boolean).join(" ");

  const headerRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.75rem",
    marginBottom: hideTitle && actions != null ? "0.5rem" : "0.75rem",
  };

  const toolbarOnly = hideTitle && actions != null;
  const showTitleBlock = !hideTitle && (title.length > 0 || actions != null);

  const titleRowStyle: CSSProperties = {
    ...headerRowStyle,
    justifyContent: title.length > 0 ? "space-between" : "flex-end",
  };

  return (
    <div className={rootClass} style={style}>
      {toolbarOnly ? (
        <div className="page-shell__toolbar page-shell__toolbar--actions-only" style={headerRowStyle}>
          <div className="page-shell__actions" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}>
            {actions}
          </div>
        </div>
      ) : showTitleBlock ? (
        actions != null ? (
          <div style={titleRowStyle}>
            {title.length > 0 ? <h1 className="page-card__title">{title}</h1> : null}
            <div className="page-shell__actions" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
              {actions}
            </div>
          </div>
        ) : (
          <h1 className="page-card__title">{title}</h1>
        )
      ) : null}
      {children}
    </div>
  );
}
