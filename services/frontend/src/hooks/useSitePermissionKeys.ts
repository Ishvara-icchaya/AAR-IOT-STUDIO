import { useEffect, useState } from "react";
import { apiFetch } from "@/api/client";

/** Effective permission keys for a specific site (not necessarily the shell scope site). */
export function useSitePermissionKeys(siteId: string | null | undefined) {
  const [keys, setKeys] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!siteId) {
      setKeys(new Set());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void apiFetch<{ permission_keys: string[] }>(`/permissions/me?site_id=${encodeURIComponent(siteId)}`)
      .then((r) => {
        if (!cancelled) setKeys(new Set((r?.permission_keys ?? []) as string[]));
      })
      .catch(() => {
        if (!cancelled) setKeys(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  const has = (k: string) => keys.has(k);
  return { keys, loading, has };
}
