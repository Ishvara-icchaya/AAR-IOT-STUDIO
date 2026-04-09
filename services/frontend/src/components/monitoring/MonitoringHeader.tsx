type Props = {
  onRefresh: () => void;
  loading: boolean;
  lastUpdated: Date | null;
};

/** Toolbar only — page title lives on `PageShell`. */
export function MonitoringHeader({ onRefresh, loading, lastUpdated }: Props) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
      <button
        type="button"
        onClick={() => void onRefresh()}
        disabled={loading}
        style={{
          padding: "0.35rem 0.75rem",
          borderRadius: "var(--radius)",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "Refreshing…" : "Refresh"}
      </button>
      {lastUpdated ? (
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
          Updated {lastUpdated.toLocaleTimeString()}
        </span>
      ) : null}
    </div>
  );
}
