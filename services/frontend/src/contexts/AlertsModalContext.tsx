import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type AlertsModalContextValue = {
  isOpen: boolean;
  detailId: string | null;
  openList: () => void;
  openDetail: (alertId: string) => void;
  close: () => void;
  backToList: () => void;
};

const AlertsModalContext = createContext<AlertsModalContextValue | null>(null);

export function AlertsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const openList = useCallback(() => {
    setDetailId(null);
    setOpen(true);
  }, []);

  const openDetail = useCallback((id: string) => {
    setDetailId(id);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setDetailId(null);
  }, []);

  const backToList = useCallback(() => {
    setDetailId(null);
  }, []);

  const value = useMemo(
    () => ({ isOpen, detailId, openList, openDetail, close, backToList }),
    [isOpen, detailId, openList, openDetail, close, backToList],
  );

  return <AlertsModalContext.Provider value={value}>{children}</AlertsModalContext.Provider>;
}

export function useAlertsModal(): AlertsModalContextValue {
  const ctx = useContext(AlertsModalContext);
  if (!ctx) {
    throw new Error("useAlertsModal must be used within AlertsModalProvider");
  }
  return ctx;
}
