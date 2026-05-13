export type MonitoringTabId =
  | "overview"
  | "services"
  | "incidents"
  | "queues"
  | "resources"
  | "storage"
  | "ai";

const TABS: { id: MonitoringTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "services", label: "Services" },
  { id: "incidents", label: "Recent incidents" },
  { id: "queues", label: "Queues" },
  { id: "resources", label: "Resources" },
  { id: "storage", label: "Storage" },
  { id: "ai", label: "AI / LLM" },
];

export function MonitoringTabs({
  active,
  onChange,
}: {
  active: MonitoringTabId;
  onChange: (t: MonitoringTabId) => void;
}) {
  return (
    <div className="monitoring-page__tabs device-lineage-detail-tabs" role="region" aria-label="Monitoring sections">
      <div className="device-lineage-detail-tabs__bar" role="tablist" aria-label="Monitoring sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            id={`monitoring-tab-${t.id}`}
            className={`device-lineage-detail-tabs__tab${active === t.id ? " device-lineage-detail-tabs__tab--active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
