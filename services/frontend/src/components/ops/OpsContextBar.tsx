import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/api/client";
import { OpsShimmerLine } from "@/components/ops/OpsShimmer";
import { useOpsShell } from "@/contexts/OpsShellContext";

type SiteRow = { id: string; name: string };

const barStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "0.65rem 1rem",
  padding: "0.45rem 0.75rem",
  margin: "0 calc(-1 * var(--space-lg)) var(--space-md)",
  width: "calc(100% + 2 * var(--space-lg))",
  boxSizing: "border-box",
  borderRadius: "var(--radius-lg)",
  border: "1px solid color-mix(in oklab, var(--color-border) 85%, transparent)",
  background: "color-mix(in oklab, var(--color-surface) 82%, transparent)",
  boxShadow: "var(--shadow-soft)",
};

const lbl: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.35rem",
  fontSize: "0.72rem",
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const sel: CSSProperties = {
  padding: "0.35rem 0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-elevated)",
  color: "var(--color-text)",
  fontSize: "0.82rem",
  minWidth: "8rem",
};

const btn: CSSProperties = {
  padding: "0.4rem 0.85rem",
  borderRadius: "var(--radius)",
  border: "1px solid color-mix(in oklab, var(--color-accent) 55%, var(--color-border))",
  background: "color-mix(in oklab, var(--color-accent) 18%, var(--color-surface))",
  color: "var(--color-text)",
  fontSize: "0.8rem",
  cursor: "pointer",
  fontWeight: 500,
  transition: "transform 0.15s ease, box-shadow 0.2s ease",
};

export function OpsContextBar() {
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

  return (
    <div className="ops-context-bar" style={barStyle}>
      <label style={lbl}>
        Site
        {loadingSites ? (
          <OpsShimmerLine width={140} />
        ) : (
          <select
            value={siteId ?? ""}
            onChange={(e) => setSiteId(e.target.value || null)}
            style={sel}
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
      <label style={lbl}>
        Range
        <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as typeof timeRange)} style={sel} aria-label="Time range">
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </label>
      <button
        type="button"
        style={btn}
        onClick={() => triggerRefresh()}
        title="Reload data on the current view and other scoped pages"
        className="ops-context-bar__refresh"
      >
        Refresh
      </button>
    </div>
  );
}
