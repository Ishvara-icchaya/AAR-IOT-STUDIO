import type { CSSProperties } from "react";

export type MonitoringTabId = "overview" | "services" | "queues" | "resources" | "storage" | "ai";

const TABS: { id: MonitoringTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "services", label: "Services" },
  { id: "queues", label: "Queues" },
  { id: "resources", label: "Resources" },
  { id: "storage", label: "Storage" },
  { id: "ai", label: "AI / LLM" },
];

const row: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.35rem",
  marginBottom: "1rem",
  borderBottom: "1px solid var(--color-border)",
  paddingBottom: "0.5rem",
};

export function MonitoringTabs({
  active,
  onChange,
}: {
  active: MonitoringTabId;
  onChange: (t: MonitoringTabId) => void;
}) {
  return (
    <div style={row} role="tablist" aria-label="Monitoring sections">
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: "var(--radius)",
              border: on ? "1px solid var(--color-accent)" : "1px solid transparent",
              background: on ? "rgba(100, 181, 246, 0.12)" : "transparent",
              color: on ? "var(--color-accent)" : "var(--color-text)",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
