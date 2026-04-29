import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function TextWidget2({
  widget,
}: {
  widget: DashboardWidgetInstance2;
  data: unknown;
  mode: "designer" | "preview" | "live";
}) {
  const body = String((widget.config.text as string | undefined) ?? widget.description ?? "Text widget");
  return <div className="dashboard2-text">{body}</div>;
}
