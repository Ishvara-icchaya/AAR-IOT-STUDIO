import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/api/client";
import { useOpsShell } from "@/contexts/OpsShellContext";

export type SitePermissionsValue = {
  loading: boolean;
  unionKeys: Set<string>;
  siteKeys: Set<string>;
  refresh: () => Promise<void>;
  hasUnion: (permissionKey: string) => boolean;
  hasSite: (permissionKey: string) => boolean;
};

const SitePermissionsContext = createContext<SitePermissionsValue | null>(null);

export function SitePermissionsProvider({ children }: { children: ReactNode }) {
  const { siteId } = useOpsShell();
  const [loading, setLoading] = useState(true);
  const [unionKeys, setUnionKeys] = useState<Set<string>>(() => new Set());
  const [siteKeys, setSiteKeys] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const u = await apiFetch<{ permission_keys: string[] }>("/permissions/me");
      const uSet = new Set((u?.permission_keys ?? []) as string[]);
      setUnionKeys(uSet);
      if (siteId) {
        const s = await apiFetch<{ permission_keys: string[] }>(
          `/permissions/me?site_id=${encodeURIComponent(siteId)}`,
        );
        setSiteKeys(new Set((s?.permission_keys ?? []) as string[]));
      } else {
        setSiteKeys(uSet);
      }
    } catch {
      setUnionKeys(new Set());
      setSiteKeys(new Set());
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () =>
      ({
        loading,
        unionKeys,
        siteKeys,
        refresh,
        hasUnion: (k: string) => unionKeys.has(k),
        hasSite: (k: string) => siteKeys.has(k),
      }) satisfies SitePermissionsValue,
    [loading, unionKeys, siteKeys, refresh],
  );

  return <SitePermissionsContext.Provider value={value}>{children}</SitePermissionsContext.Provider>;
}

export function useSitePermissions(): SitePermissionsValue {
  const ctx = useContext(SitePermissionsContext);
  if (!ctx) throw new Error("useSitePermissions must be used within SitePermissionsProvider");
  return ctx;
}

export function useSitePermissionsOptional(): SitePermissionsValue | null {
  return useContext(SitePermissionsContext);
}
