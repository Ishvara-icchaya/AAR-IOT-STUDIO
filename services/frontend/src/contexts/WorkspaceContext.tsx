import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type WorkspaceContextValue = {
  open: boolean;
  openWorkspace: () => void;
  closeWorkspace: () => void;
  inboxRefreshKey: number;
  bumpInbox: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [inboxRefreshKey, setInboxRefreshKey] = useState(0);

  const openWorkspace = useCallback(() => setOpen(true), []);
  const closeWorkspace = useCallback(() => setOpen(false), []);
  const bumpInbox = useCallback(() => setInboxRefreshKey((k) => k + 1), []);

  const value = useMemo(
    () => ({
      open,
      openWorkspace,
      closeWorkspace,
      inboxRefreshKey,
      bumpInbox,
    }),
    [open, openWorkspace, closeWorkspace, inboxRefreshKey, bumpInbox],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return v;
}
