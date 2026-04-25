import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ConfirmActionModal } from "@/components/app/ConfirmActionModal";

type ConfirmVariant = "default" | "danger" | "warning" | "success";

export type ConfirmActionOptions = {
  title: string;
  message: string | ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  requireText?: string;
  /** Optional async body: modal keeps loading and surfaces thrown errors in-place. */
  onConfirm?: () => void | Promise<void>;
};

type PendingConfirm = {
  options: ConfirmActionOptions;
  resolve: (ok: boolean) => void;
};

type ConfirmActionContextValue = {
  confirm: (options: ConfirmActionOptions) => Promise<boolean>;
};

const ConfirmActionContext = createContext<ConfirmActionContextValue | null>(null);

export function ConfirmActionProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    setPending(null);
    setLoading(false);
    setError(null);
  }, []);

  const confirm = useCallback((options: ConfirmActionOptions) => {
    return new Promise<boolean>((resolve) => {
      setError(null);
      setLoading(false);
      setPending({ options, resolve });
    });
  }, []);

  const onCancel = useCallback(() => {
    if (!pending || loading) return;
    pending.resolve(false);
    clear();
  }, [pending, loading, clear]);

  const onConfirm = useCallback(async () => {
    if (!pending) return;
    const fn = pending.options.onConfirm;
    if (!fn) {
      pending.resolve(true);
      clear();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await fn();
      pending.resolve(true);
      clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      setLoading(false);
    }
  }, [pending, clear]);

  const value = useMemo(
    () => ({
      confirm,
    }),
    [confirm],
  );

  const variant = pending?.options.variant ?? "default";

  return (
    <ConfirmActionContext.Provider value={value}>
      {children}
      <ConfirmActionModal
        open={Boolean(pending)}
        title={pending?.options.title ?? ""}
        message={pending?.options.message ?? ""}
        confirmLabel={pending?.options.confirmLabel ?? "Confirm"}
        cancelLabel={pending?.options.cancelLabel}
        variant={variant}
        requireText={pending?.options.requireText}
        loading={loading}
        errorMessage={error}
        allowBackdropClose={variant !== "danger"}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </ConfirmActionContext.Provider>
  );
}

export function useConfirmAction(): ConfirmActionContextValue["confirm"] {
  const ctx = useContext(ConfirmActionContext);
  if (!ctx) throw new Error("useConfirmAction must be used within ConfirmActionProvider");
  return ctx.confirm;
}
