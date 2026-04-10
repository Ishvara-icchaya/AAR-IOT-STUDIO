import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type OpsTimeRange = "1h" | "24h" | "7d" | "30d";

type OpsShellValue = {
  siteId: string | null;
  setSiteId: (id: string | null) => void;
  timeRange: OpsTimeRange;
  setTimeRange: (r: OpsTimeRange) => void;
  /** Increments when the user clicks Refresh in the context bar */
  refreshToken: number;
  triggerRefresh: () => void;
};

const OpsShellContext = createContext<OpsShellValue | null>(null);

export function OpsShellProvider({ children }: { children: ReactNode }) {
  const [siteId, setSiteId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("ops.siteId");
    } catch {
      return null;
    }
  });
  const [timeRange, setTimeRangeState] = useState<OpsTimeRange>(() => {
    try {
      const s = localStorage.getItem("ops.timeRange");
      if (s === "1h" || s === "24h" || s === "7d" || s === "30d") return s;
    } catch {
      /* ignore */
    }
    return "24h";
  });
  const [refreshToken, setRefreshToken] = useState(0);

  const setSiteIdPersist = useCallback((id: string | null) => {
    setSiteId(id);
    try {
      if (id) localStorage.setItem("ops.siteId", id);
      else localStorage.removeItem("ops.siteId");
    } catch {
      /* ignore */
    }
  }, []);

  const setTimeRange = useCallback((r: OpsTimeRange) => {
    setTimeRangeState(r);
    try {
      localStorage.setItem("ops.timeRange", r);
    } catch {
      /* ignore */
    }
  }, []);

  const triggerRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1);
    window.dispatchEvent(new CustomEvent("ops-shell-refresh"));
  }, []);

  const value = useMemo(
    () =>
      ({
        siteId,
        setSiteId: setSiteIdPersist,
        timeRange,
        setTimeRange,
        refreshToken,
        triggerRefresh,
      }) satisfies OpsShellValue,
    [siteId, setSiteIdPersist, timeRange, setTimeRange, refreshToken, triggerRefresh],
  );

  return <OpsShellContext.Provider value={value}>{children}</OpsShellContext.Provider>;
}

export function useOpsShell(): OpsShellValue {
  const ctx = useContext(OpsShellContext);
  if (!ctx) {
    throw new Error("useOpsShell must be used within OpsShellProvider");
  }
  return ctx;
}

/** Safe hook when provider may be absent (e.g. tests). */
export function useOpsShellOptional(): OpsShellValue | null {
  return useContext(OpsShellContext);
}
