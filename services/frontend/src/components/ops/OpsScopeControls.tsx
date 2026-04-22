import { useCallback, useEffect, useState } from "react";
import "./ops-scope-controls.css";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/api/client";
import { OpsShimmerLine } from "@/components/ops/OpsShimmer";
import { useOpsShell, type OpsTimeRange } from "@/contexts/OpsShellContext";

type SiteRow = { id: string; name: string };

type Props = {
  /** `bar` = padded strip (shell). `inline` = compact row for Manage Devices header. */
  variant?: "bar" | "inline";
  /** Label for the time dropdown (shell uses "Range"). */
  timeRangeLabel?: string;
};

export function OpsScopeControls({ variant = "bar", timeRangeLabel = "Range" }: Props) {
  const { siteId, setSiteId, timeRange, setTimeRange, triggerRefresh } = useOpsShell();
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);

  const loadSites = useCallback(async () => {
    setLoadingSites(true);
    try {
      const data = await apiFetch<SiteRow[]>("/administration/sites");
      setSites(data ?? []);
    } catch {
      setSites([]);
    } finally {
      setLoadingSites(false);
    }
  }, []);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  useEffect(() => {
    if (!sites.length || siteId) return;
    setSiteId(sites[0].id);
  }, [sites, siteId, setSiteId]);

  const isInline = variant === "inline";

  return (
    <div className={isInline ? "ops-scope-inline" : "ops-scope-bar"}>
      <label className={isInline ? "ops-scope-inline__field" : "ops-scope-bar__field"}>
        <span className={isInline ? "ops-scope-inline__lbl" : "ops-scope-bar__lbl"}>Site</span>
        {loadingSites ? (
          <OpsShimmerLine width={140} />
        ) : (
          <select
            className={isInline ? "ops-scope-inline__sel" : "ops-scope-bar__sel"}
            value={siteId ?? ""}
            onChange={(e) => setSiteId(e.target.value || null)}
            aria-label="Site scope"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className={isInline ? "ops-scope-inline__field" : "ops-scope-bar__field"}>
        <span className={isInline ? "ops-scope-inline__lbl" : "ops-scope-bar__lbl"}>{timeRangeLabel}</span>
        <select
          className={isInline ? "ops-scope-inline__sel" : "ops-scope-bar__sel"}
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as OpsTimeRange)}
          aria-label="Time range"
        >
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </label>
      <button
        type="button"
        className={isInline ? "ops-scope-inline__refresh" : "ops-scope-bar__refresh"}
        onClick={() => triggerRefresh()}
        title="Reload using the Site and time range above"
      >
        <RefreshCw size={15} strokeWidth={2} aria-hidden />
        Refresh
      </button>
    </div>
  );
}
