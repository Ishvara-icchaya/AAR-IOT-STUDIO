import { useEffect, useMemo, useState } from "react";
import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import { DashboardSourceSelector } from "./DashboardSourceSelector";
import { DashboardBindingEditor } from "./DashboardBindingEditor";
import * as dashApi from "@/api/dashboard";
import { DashboardWidgetView } from "./DashboardLiveRenderer";

function findWidget(
  layout: ReturnType<typeof useDashboardBuilderStore.getState>["layout"],
  rowId: string,
  columnId: string,
): DashboardWidgetModel | null {
  const row = layout.rows.find((r) => r.rowId === rowId);
  const col = row?.columns.find((c) => c.columnId === columnId);
  return col?.widget ?? null;
}

export function DashboardWidgetConfigDrawer({ dashboardId }: { dashboardId: string }) {
  const open = useDashboardBuilderStore((s) => s.drawerOpen);
  const target = useDashboardBuilderStore((s) => s.drawerTarget);
  const layout = useDashboardBuilderStore((s) => s.layout);
  const siteId = useDashboardBuilderStore((s) => s.siteId);
  const status = useDashboardBuilderStore((s) => s.status);
  const closeDrawer = useDashboardBuilderStore((s) => s.closeDrawer);
  const updateWidget = useDashboardBuilderStore((s) => s.updateWidget);

  const base = useMemo(() => {
    if (!target) return null;
    return findWidget(layout, target.rowId, target.columnId);
  }, [layout, target]);

  const [draft, setDraft] = useState<DashboardWidgetModel | null>(null);
  const [singlePreview, setSinglePreview] = useState<Awaited<ReturnType<typeof dashApi.previewDashboard>> | null>(null);

  useEffect(() => {
    setDraft(base);
  }, [base, open, target?.rowId, target?.columnId]);

  const draftKey = draft ? JSON.stringify(draft) : "";

  useEffect(() => {
    if (!open || !draft || !target) {
      setSinglePreview(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const miniLayout: Record<string, unknown> = {
        version: 1,
        rows: [
          {
            rowId: "preview_row",
            columns: [
              {
                columnId: "preview_col",
                span: 12,
                widget: {
                  widgetId: draft.widgetId,
                  type: draft.type,
                  title: draft.title,
                  binding: draft.binding,
                  config: draft.config,
                },
              },
            ],
          },
        ],
      };
      void (async () => {
        try {
          const r = await dashApi.previewDashboard(dashboardId, { layout: miniLayout });
          if (!cancelled) setSinglePreview(r);
        } catch {
          if (!cancelled) setSinglePreview(null);
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, dashboardId, target?.rowId, target?.columnId, draftKey]);

  if (!open || !target || !draft) return null;

  const frozen = status === "frozen";
  const needsSource =
    !["text", "health_summary", "alert_summary", "site_summary"].includes(draft.type) &&
    !(draft.type === "map" && draft.config.autoIncludeGpsObjects !== false);

  function onSaveWidget() {
    const t = target;
    const w = draft;
    if (!t || !w) return;
    updateWidget(t.rowId, t.columnId, w);
    closeDrawer();
  }

  const previewWidget = singlePreview?.widgets?.[0];

  return (
    <div className="dash-drawer-backdrop" role="presentation" onClick={closeDrawer}>
      <aside className="dash-drawer" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <header className="dash-drawer__head">
          <h2>Configure widget</h2>
          <button type="button" className="dash-drawer__close" onClick={closeDrawer} aria-label="Close">
            ×
          </button>
        </header>
        <div className="dash-drawer__body">
          <DashboardBindingEditor widget={draft} onChange={setDraft} disabled={frozen} />

          {needsSource && (
            <label className="dash-drawer__label">
              Source type
              <select
                className="dash-drawer__input"
                value={(draft.binding.sourceType as string) || "data_object"}
                disabled={frozen}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    binding: {
                      ...draft.binding,
                      sourceType: e.target.value as "data_object" | "result_object",
                      sourceId: "",
                    },
                  })
                }
              >
                <option value="data_object">data_object</option>
                <option value="result_object">result_object</option>
              </select>
            </label>
          )}

          {needsSource && (
            <DashboardSourceSelector
              siteId={siteId}
              sourceType={(draft.binding.sourceType as "data_object" | "result_object") || "data_object"}
              value={String(draft.binding.sourceId ?? "")}
              disabled={frozen}
              onChange={(id) => setDraft({ ...draft, binding: { ...draft.binding, sourceId: id } })}
            />
          )}

          <section className="dash-drawer__preview">
            <h3>Preview</h3>
            {previewWidget ? (
              <DashboardWidgetView block={previewWidget} />
            ) : (
              <p className="dash-widget__muted">Resolve preview…</p>
            )}
          </section>

          <details className="dash-drawer__debug">
            <summary>Debug JSON</summary>
            <pre>{JSON.stringify(draft, null, 2)}</pre>
          </details>
        </div>
        <footer className="dash-drawer__foot">
          {!frozen && (
            <button type="button" className="dash-btn dash-btn--accent" onClick={onSaveWidget}>
              Save widget
            </button>
          )}
          <button type="button" className="dash-btn dash-btn--secondary" onClick={closeDrawer}>
            Close
          </button>
        </footer>
      </aside>
    </div>
  );
}
