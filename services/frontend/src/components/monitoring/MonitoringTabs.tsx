import { AppTabs } from "@/components/app";

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
    <div className="monitoring-page__tabs">
      <AppTabs tabs={TABS} active={active} onChange={onChange} ariaLabel="Monitoring sections" />
    </div>
  );
}
