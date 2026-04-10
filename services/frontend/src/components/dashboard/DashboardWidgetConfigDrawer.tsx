import { useEffect, useMemo, useState } from "react";
import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import { DashboardSourceSelector } from "./DashboardSourceSelector";
import { DashboardBindingEditor } from "./DashboardBindingEditor";
import { DashboardChartConfigSection } from "./DashboardChartConfigSection";
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

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDrawer();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDrawer]);

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
  const mapManualWithIncluded =
    draft.type === "map" &&
    draft.config.autoIncludeGpsObjects === false &&
    Array.isArray(draft.config.includedSources) &&
    (draft.config.includedSources as unknown[]).length > 0;
  const needsSource =
    !["text", "health_summary", "alert_summary", "site_summary"].includes(draft.type) &&
    !(draft.type === "map" && draft.config.autoIncludeGpsObjects !== false) &&
    !mapManualWithIncluded;

  function onSaveWidget() {
    const t = target;
    const w = draft;
    if (!t || !w) return;
    updateWidget(t.rowId, t.columnId, w);
    closeDrawer();
  }

  const previewWidget = singlePreview?.widgets?.[0];

  const isChart = draft.type === "chart";

  return (
    <div className="dash-config-modal-backdrop" role="presentation" onClick={closeDrawer}>
      <div
        className="dash-config-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dash-config-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dash-config-modal__head dash-drawer__head">
          <h2 id="dash-config-modal-title">{isChart ? "Configure chart" : "Configure widget"}</h2>
          <button type="button" className="dash-drawer__close" onClick={closeDrawer} aria-label="Close">
            ×
          </button>
        </header>
        <div className="dash-config-modal__body dash-drawer__body">
          {isChart ? (
            <div className="dash-chart-config-flow">
              <label className="dash-drawer__label dash-chart-config-flow__row">
                Title
                <input
                  className="dash-drawer__input"
                  value={draft.title}
                  disabled={frozen}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>

              <label className="dash-drawer__label dash-chart-config-flow__row">
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

              <div className="dash-chart-config-flow__row">
                <DashboardSourceSelector
                  siteId={siteId}
                  sourceType={(draft.binding.sourceType as "data_object" | "result_object") || "data_object"}
                  value={String(draft.binding.sourceId ?? "")}
                  disabled={frozen}
                  onChange={(id) => setDraft({ ...draft, binding: { ...draft.binding, sourceId: id } })}
                />
              </div>

              <div className="dash-chart-config-flow__row dash-chart-config-flow__row--axes">
                <DashboardChartConfigSection widget={draft} onChange={setDraft} disabled={frozen} />
              </div>

              <section className="dash-drawer__preview dash-chart-config-flow__row dash-chart-config-flow__row--preview">
                <h3>Chart preview</h3>
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
          ) : (
            <>
              <DashboardBindingEditor widget={draft} onChange={setDraft} disabled={frozen} siteId={siteId} />

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
            </>
          )}
        </div>
        <footer className="dash-config-modal__foot dash-drawer__foot">
          {!frozen && (
            <button type="button" className="dash-btn dash-btn--accent" onClick={onSaveWidget}>
              Save widget
            </button>
          )}
          <button type="button" className="dash-btn dash-btn--secondary" onClick={closeDrawer}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
