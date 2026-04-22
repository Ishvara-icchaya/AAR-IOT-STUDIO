import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";
import { DashboardLiveRenderer } from "./DashboardLiveRenderer";

export function DashboardPreviewPanel() {
  const previewPayload = useDashboardBuilderStore((s) => s.previewPayload);

  const dash = previewPayload?.dashboard && typeof previewPayload.dashboard === "object"
    ? previewPayload.dashboard
    : undefined;
  const layout = dash ? (dash as Record<string, unknown>).layout : undefined;

  return (
    <aside className="dash-preview-panel">
      <h2 className="dash-preview-panel__title">Preview</h2>
      <p className="dash-widget__muted" style={{ fontSize: "0.8rem" }}>
        Click <strong>Preview</strong> in the header to resolve widget data for the current canvas (including unsaved
        changes).
      </p>
      {previewPayload && layout ? (
        <div className="dash-preview-panel__scroll dash-preview-panel__scroll--fit">
          <DashboardLiveRenderer
            layout={layout}
            widgets={Array.isArray(previewPayload.widgets) ? previewPayload.widgets : []}
            renderedAt={previewPayload.rendered_at}
            dashboard={dash}
          />
        </div>
      ) : (
        <p className="dash-widget__muted" style={{ marginTop: "0.5rem" }}>
          No preview yet.
        </p>
      )}
    </aside>
  );
}
