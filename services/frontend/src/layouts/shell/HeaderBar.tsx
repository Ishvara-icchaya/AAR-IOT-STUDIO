import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { useOpsShell } from "@/contexts/OpsShellContext";
import { useSitePermissionsOptional } from "@/contexts/SitePermissionsContext";
import { getAlertsSummary } from "@/api/alerts";
import { AarTopNav } from "./AarTopNav";

type SiteRow = { id: string; name: string };

const NAV_PERM: Record<string, string> = {
  devices: "devices.read",
  pipelines: "scrubbers.read",
  registerEndpoint: "endpoints.read",
  workflows: "workflows.read",
  dashboards: "dashboards.read",
  monitoring: "devices.read",
  ai: "devices.read",
};

export function HeaderBar() {
  const { me } = useAuth();
  const { siteId, setSiteId, triggerRefresh } = useOpsShell();
  const sitePerms = useSitePermissionsOptional();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [unacked, setUnacked] = useState(0);
  const [alertTone, setAlertTone] = useState<"none" | "critical" | "warning" | "info">("none");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<SiteRow[]>("/administration/sites");
        if (!cancelled) setSites(data ?? []);
      } catch {
        if (!cancelled) setSites([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const s = await getAlertsSummary();
        if (!cancelled && s) {
          setUnacked(s.total_unacknowledged);
          const c = s.critical ?? (s.has_critical ? 1 : 0);
          const w = s.warning ?? 0;
          const i = s.info ?? 0;
          if (c > 0) setAlertTone("critical");
          else if (w > 0) setAlertTone("warning");
          else if (i > 0) setAlertTone("info");
          else setAlertTone("none");
        }
      } catch {
        if (!cancelled) {
          setUnacked(0);
          setAlertTone("none");
        }
      }
    }
    void poll();
    const t = window.setInterval(() => void poll(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const navItemVisible = useCallback(
    (key: string) => {
      if (!sitePerms || sitePerms.loading) return true;
      if (me?.is_superuser) return true;
      const need = NAV_PERM[key];
      if (!need) return true;
      return sitePerms.hasUnion(need);
    },
    [sitePerms, me?.is_superuser],
  );

  const customerLabel = (me?.customer_name || "").trim() || "—";
  let siteSummary = "—";
  if (sites.length === 1) siteSummary = sites[0].name;
  else if (sites.length > 1) siteSummary = `${sites.length} sites`;

  return (
    <header className="shell-header shell-header--aar-topnav" aria-label="Application header">
      <AarTopNav
        customerName={customerLabel}
        siteSummary={siteSummary}
        sites={sites}
        selectedSiteId={siteId}
        onSiteChange={setSiteId}
        alertCount={unacked}
        alertTone={alertTone}
        onRefresh={triggerRefresh}
        navItemVisible={navItemVisible}
      />
    </header>
  );
}
