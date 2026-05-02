import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import "./app-modal.css";

const Z_OVERLAY = 12000;

export type AppModalSize = "md" | "lg" | "xl";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Default `lg` — matches identity / wide endpoint forms */
  size?: AppModalSize;
  /** Extra class on the dialog (e.g. max-height override) */
  dialogClassName?: string;
  /** Skip padding on body (full-bleed content) */
  bodyFlush?: boolean;
  titleId?: string;
  closeOnBackdrop?: boolean;
};

export function AppModalShell({
  open,
  title,
  subtitle,
  onClose,
  children,
  size = "lg",
  dialogClassName = "",
  bodyFlush = false,
  titleId = "app-modal-title",
  closeOnBackdrop = true,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="app-modal__overlay"
      style={{ zIndex: Z_OVERLAY }}
      role="presentation"
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`app-modal__dialog app-modal__dialog--${size} ${dialogClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="app-modal__header">
          <div className="app-modal__header-text">
            <h2 id={titleId} className="app-modal__title">
              {title}
            </h2>
            {subtitle ? <p className="app-modal__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="app-modal__close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </header>
        <div className={bodyFlush ? "app-modal__body app-modal__body--flush" : "app-modal__body"}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
