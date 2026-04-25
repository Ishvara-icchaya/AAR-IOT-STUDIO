import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import "./confirm-action-modal.css";

type Variant = "default" | "danger" | "warning" | "success";

type Props = {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: Variant;
  requireText?: string;
  loading?: boolean;
  errorMessage?: string | null;
  allowBackdropClose?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function ConfirmActionModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "default",
  requireText,
  loading = false,
  errorMessage,
  allowBackdropClose = true,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const errorId = useId();

  const confirmClass = useMemo(() => {
    if (variant === "danger") return "dm-btn dm-btn--danger";
    if (variant === "warning") return "dm-btn dm-btn--warning";
    return "dm-btn dm-btn--primary";
  }, [variant]);

  const requiresTypedText = typeof requireText === "string" && requireText.length > 0;
  const blockedByRequireText = requiresTypedText && typed !== requireText;
  const canDismiss = !loading;

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTyped("");
    const id = window.setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (canDismiss) onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"),
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canDismiss, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-action-modal__backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (!allowBackdropClose || !canDismiss) return;
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={rootRef}
        className="confirm-action-modal"
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        aria-describedby={descId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-action-modal__head">
          <h2 id={titleId} className="confirm-action-modal__title">
            {title}
          </h2>
        </div>
        <div id={descId} className="confirm-action-modal__body">
          {message}
        </div>
        {requiresTypedText ? (
          <div className="confirm-action-modal__require">
            <label className="confirm-action-modal__require-label">
              Type <code>{requireText}</code> to continue
            </label>
            <input
              className="confirm-action-modal__input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
          </div>
        ) : null}
        {errorMessage ? (
          <div id={errorId} className="confirm-action-modal__error" role="alert">
            {errorMessage}
          </div>
        ) : null}
        <div className="confirm-action-modal__actions">
          <button type="button" className="dm-btn dm-btn--outline" onClick={onCancel} disabled={!canDismiss}>
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={confirmClass}
            onClick={() => void onConfirm()}
            disabled={loading || blockedByRequireText}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
