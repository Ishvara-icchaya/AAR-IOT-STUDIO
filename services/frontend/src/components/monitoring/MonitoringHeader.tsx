import { RefreshCw } from "lucide-react";

type Props = {
  onRefresh: () => void;
  loading: boolean;
  lastUpdated: Date | null;
};

/** Toolbar only — page title lives in the shell page bar. */
export function MonitoringHeader({ onRefresh, loading, lastUpdated }: Props) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
      <button
        type="button"
        onClick={() => void onRefresh()}
        disabled={loading}
        className="monitoring-header__refresh"
        title="Refresh"
      >
        <RefreshCw size={16} strokeWidth={2} className={loading ? "monitoring-header__spin" : undefined} aria-hidden />
        <span>{loading ? "Refreshing…" : "Refresh"}</span>
      </button>
      {lastUpdated ? (
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
          Updated {lastUpdated.toLocaleTimeString()}
        </span>
      ) : null}
    </div>
  );
}
