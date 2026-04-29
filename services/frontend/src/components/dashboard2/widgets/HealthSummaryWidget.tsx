import type { ResolvedDeviceCollectionRuntimeResponse } from "@/api/dashboard";
import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function HealthSummaryWidget({
  data,
}: {
  widget: DashboardWidgetInstance2;
  data: unknown;
  mode: "designer" | "preview" | "live";
}) {
  const collection = data as ResolvedDeviceCollectionRuntimeResponse | null;
  const s = (collection?.summary ?? {}) as Record<string, unknown>;
  const cards = [
    { label: "Healthy", value: Number(s.healthy ?? 0) },
    { label: "Warning", value: Number(s.warning ?? 0) },
    { label: "Critical", value: Number(s.critical ?? 0) },
    { label: "Unknown", value: Number(s.unknown ?? 0) },
  ];
  return (
    <div className="dashboard2-health-grid">
      {cards.map((c) => (
        <div key={c.label} className="dashboard2-health-card">
          <span>{c.label}</span>
          <strong>{c.value}</strong>
        </div>
      ))}
    </div>
  );
}
