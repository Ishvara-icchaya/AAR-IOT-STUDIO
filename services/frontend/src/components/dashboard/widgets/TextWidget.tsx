import type { DashboardLiveWidgetDTO } from "@/types/dashboard";

export function TextWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const body = String(block.data?.body ?? "");
  return (
    <div className="dash-widget dash-widget--text">
      <h3 className="dash-widget__title">{block.title}</h3>
      <div className="dash-widget__body">{body}</div>
    </div>
  );
}
