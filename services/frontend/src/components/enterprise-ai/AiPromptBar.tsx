import type { FormEvent } from "react";

type SiteOpt = { id: string; name: string };

export function AiPromptBar({
  sites,
  selectedSiteIds,
  onSitesChange,
  timeRange,
  onTimeRangeChange,
  useLlm,
  onUseLlmChange,
  debugRaw,
  onDebugRawChange,
  showDebug,
  message,
  onMessageChange,
  onSubmit,
  loading,
}: {
  sites: SiteOpt[];
  selectedSiteIds: string[];
  onSitesChange: (ids: string[]) => void;
  timeRange: string;
  onTimeRangeChange: (v: string) => void;
  useLlm: boolean;
  onUseLlmChange: (v: boolean) => void;
  debugRaw: boolean;
  onDebugRawChange: (v: boolean) => void;
  showDebug: boolean;
  message: string;
  onMessageChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={onFormSubmit} style={{ marginBottom: "1rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "flex-end",
          marginBottom: "0.75rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
          Sites
          <select
            multiple
            value={selectedSiteIds}
            onChange={(e) => {
              const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
              onSitesChange(opts);
            }}
            style={{ minWidth: "200px", minHeight: "72px", padding: "0.25rem" }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
            Empty = all sites you can access
          </span>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
          Time range
          <select value={timeRange} onChange={(e) => onTimeRangeChange(e.target.value)} style={{ padding: "0.35rem" }}>
            <option value="last_24_hours">Last 24 hours</option>
            <option value="last_7_days">Last 7 days</option>
            <option value="last_30_days">Last 30 days</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
          <input type="checkbox" checked={useLlm} onChange={(e) => onUseLlmChange(e.target.checked)} />
          Use local LLM (after structured retrieval)
        </label>
        {showDebug ? (
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", color: "#f9a825" }}>
            <input type="checkbox" checked={debugRaw} onChange={(e) => onDebugRawChange(e.target.checked)} />
            Debug raw payload (admin)
          </label>
        ) : null}
        <button
          type="submit"
          disabled={loading || !message.trim()}
          style={{
            padding: "0.45rem 1rem",
            borderRadius: "var(--radius)",
            border: "none",
            background: "var(--color-accent)",
            color: "#111",
            cursor: loading || !message.trim() ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.9rem" }}>
        Question
        <textarea
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          rows={4}
          placeholder="e.g. Summarize critical alerts for my sites in the last 24 hours"
          style={{
            width: "100%",
            padding: "0.5rem",
            borderRadius: "var(--radius)",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            resize: "vertical",
          }}
        />
      </label>
    </form>
  );
}
