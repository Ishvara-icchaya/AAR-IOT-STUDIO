import type { DashboardLiveWidgetDTO } from "@/types/dashboard";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { adaptTextWidget } from "@/lib/dashboard/adapters/widgetDataAdapters";
import { resolveWidgetPresentation } from "@/lib/widgetPresentation";

export function TextWidget({ block }: { block: DashboardLiveWidgetDTO }) {
  const pres = resolveWidgetPresentation(block);
  const vm = adaptTextWidget(block);
  const body = vm.body;
  const state = body.trim() ? "normal" : "empty";

  return (
    <DashboardWidgetFrame
      block={block}
      presentation={pres}
      state={state}
      widgetKind="text"
      emptyMessage="No text configured."
      bodyFill={false}
    >
      <div className="dash-widget__body dash-wf-text__body">{body}</div>
    </DashboardWidgetFrame>
  );
}
