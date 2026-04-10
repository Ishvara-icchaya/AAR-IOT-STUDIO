import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiHttpError } from "@/api/client";
import { ResourceInUseDialog } from "@/components/integrity/ResourceInUseDialog";
import { parseResourceInUseDetail } from "@/lib/resourceInUse";
import type { ResourceInUseDetail } from "@/types/integrity";

type ResourceInUseContextValue = {
  /** Opens the shared dialog when `e` is a 409 `resource_in_use` response. Returns true if handled. */
  tryHandleResourceInUseError: (e: unknown) => boolean;
  /** Imperative open (e.g. after prefetching dependencies). */
  showResourceInUse: (detail: ResourceInUseDetail) => void;
  close: () => void;
};

const ResourceInUseContext = createContext<ResourceInUseContextValue | null>(null);

export function ResourceInUseProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ResourceInUseDetail | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setDetail(null);
  }, []);

  const showResourceInUse = useCallback((d: ResourceInUseDetail) => {
    setDetail(d);
    setOpen(true);
  }, []);

  const tryHandleResourceInUseError = useCallback((e: unknown) => {
    if (!(e instanceof ApiHttpError) || e.status !== 409) return false;
    const d = parseResourceInUseDetail(e.body);
    if (!d) return false;
    setDetail(d);
    setOpen(true);
    return true;
  }, []);

  const value = useMemo(
    () => ({ tryHandleResourceInUseError, showResourceInUse, close }),
    [tryHandleResourceInUseError, showResourceInUse, close],
  );

  return (
    <ResourceInUseContext.Provider value={value}>
      {children}
      <ResourceInUseDialog open={open} detail={detail} onClose={close} />
    </ResourceInUseContext.Provider>
  );
}

export function useResourceInUse(): ResourceInUseContextValue {
  const ctx = useContext(ResourceInUseContext);
  if (!ctx) {
    throw new Error("useResourceInUse must be used under ResourceInUseProvider");
  }
  return ctx;
}
