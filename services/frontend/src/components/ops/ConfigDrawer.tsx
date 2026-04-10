import type { CSSProperties, ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Above shell content, page-card glow (stacking contexts), and dashboard z-1000 overlays. */
const Z_BACKDROP = 12000;
const Z_PANEL = 12001;

const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  zIndex: Z_BACKDROP,
  animation: "ops-backdrop-in 0.2s ease-out",
};

const panelBase: CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  height: "100vh",
  maxWidth: "100%",
  zIndex: Z_PANEL,
  display: "flex",
  flexDirection: "column",
  background: "var(--color-surface)",
  borderLeft: "1px solid var(--color-border)",
  boxShadow: "var(--shadow-glow, -12px 0 40px rgba(0,0,0,0.4))",
  animation: "ops-drawer-in 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
};

export function ConfigDrawer({
  open,
  title,
  subtitle,
  children,
  onClose,
  width = 420,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const node = (
    <>
      <button
        type="button"
        aria-label="Close panel"
        style={backdrop}
        onClick={onClose}
      />
      <aside
        className="config-drawer"
        style={{ ...panelBase, width: `min(100vw - 12px, ${width}px)` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-drawer-title"
      >
        <div
          style={{
            flexShrink: 0,
            padding: "0.85rem 1rem",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.75rem",
            background: "color-mix(in oklab, var(--color-surface-elevated) 88%, transparent)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2 id="config-drawer-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>
              {title}
            </h2>
            {subtitle ? (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.78rem", color: "var(--color-text-muted)" }}>{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              background: "var(--color-surface-elevated)",
              color: "var(--color-text)",
              cursor: "pointer",
              padding: "0.25rem 0.55rem",
              fontSize: "0.85rem",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "0.75rem 1rem 1rem",
          }}
        >
          {children}
        </div>
        {footer ? (
          <div
            style={{
              flexShrink: 0,
              padding: "0.65rem 1rem",
              borderTop: "1px solid var(--color-border)",
              background: "color-mix(in oklab, var(--color-bg) 60%, transparent)",
            }}
          >
            {footer}
          </div>
        ) : null}
      </aside>
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
