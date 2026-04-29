import { useEffect, useMemo, useState } from "react";
import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import { DashboardSourceSelector } from "./DashboardSourceSelector";
import { DashboardBindingEditor } from "./DashboardBindingEditor";
import { DashboardChartConfigSection } from "./DashboardChartConfigSection";
import * as dashApi from "@/api/dashboard";
import { DashboardWidgetView } from "./DashboardWidgetView";

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
  const [collectionOptions, setCollectionOptions] = useState<dashApi.ResolvedDeviceCollectionSourceItem[]>([]);

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

  useEffect(() => {
    if (!open || !siteId) {
      setCollectionOptions([]);
      return;
    }
    let cancelled = false;
    void dashApi
      .listDashboardResolvedDeviceCollectionSources(siteId)
      .then((r) => {
        if (!cancelled) setCollectionOptions(r?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setCollectionOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, siteId]);

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
  const sourceMode =
    (draft.binding.sourceMode as "endpoint_group" | "individual_device" | undefined) ??
    (draft.binding.sourceType === "resolved_device_collection" ? "endpoint_group" : "individual_device");

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
                Source mode
                <select
                  className="dash-drawer__input"
                  value={sourceMode}
                  disabled={frozen}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      binding: {
                        ...draft.binding,
                        sourceMode: e.target.value as "endpoint_group" | "individual_device",
                        sourceType:
                          e.target.value === "endpoint_group"
                            ? "resolved_device_collection"
                            : ("latest_device_state" as const),
                        sourceId: "",
                      },
                    })
                  }
                >
                  <option value="endpoint_group">Endpoint Group (default)</option>
                  <option value="individual_device">Individual Device (advanced)</option>
                </select>
              </label>

              {sourceMode === "endpoint_group" ? (
                <label className="dash-drawer__label dash-chart-config-flow__row">
                  Endpoint Group
                  <select
                    className="dash-drawer__input"
                    value={`${String(draft.binding.endpointId ?? "")}|${String(draft.binding.objectName ?? "")}`}
                    disabled={frozen || !siteId}
                    onChange={(e) => {
                      const [endpointId, objectName] = e.target.value.split("|");
                      setDraft({
                        ...draft,
                        binding: {
                          ...draft.binding,
                          sourceMode: "endpoint_group",
                          sourceType: "resolved_device_collection",
                          siteId: String(siteId ?? ""),
                          endpointId: endpointId || "",
                          objectName: objectName || "",
                          sourceId: "",
                        },
                      });
                    }}
                  >
                    <option value="">— Select endpoint + object —</option>
                    {collectionOptions.map((opt) => {
                      const v = `${opt.endpoint_id}|${opt.object_name}`;
                      const endpointLabel = opt.endpoint_name || opt.endpoint_id.slice(0, 8);
                      return (
                        <option key={v} value={v}>
                          {endpointLabel} · {opt.object_name} ({opt.resolved_device_count})
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : (
                <>
                  <label className="dash-drawer__label dash-chart-config-flow__row">
                    Source type
                    <select
                      className="dash-drawer__input"
                      value={(draft.binding.sourceType as string) || "latest_device_state"}
                      disabled={frozen}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          binding: {
                            ...draft.binding,
                            sourceMode: "individual_device",
                            sourceType: e.target.value as "result_object" | "latest_device_state",
                            sourceId: "",
                          },
                        })
                      }
                    >
                      <option value="latest_device_state">latest_device_state</option>
                      <option value="result_object">result_object</option>
                    </select>
                  </label>
                  <div className="dash-chart-config-flow__row">
                    <DashboardSourceSelector
                      siteId={siteId}
                      sourceType={
                        (draft.binding.sourceType as "result_object" | "latest_device_state") ||
                        "latest_device_state"
                      }
                      value={String(draft.binding.sourceId ?? "")}
                      disabled={frozen}
                      onChange={(id) => setDraft({ ...draft, binding: { ...draft.binding, sourceId: id } })}
                    />
                  </div>
                </>
              )}

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
            <div className="dash-widget-config-grid">
              <section className="dash-widget-config-col dash-widget-config-col--controls">
                <h3>Widget settings</h3>
                <label className="dash-drawer__label">
                  Title
                  <input
                    className="dash-drawer__input"
                    value={draft.title}
                    disabled={frozen}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </label>

                {needsSource && (
                  <label className="dash-drawer__label">
                    Source mode
                    <select
                      className="dash-drawer__input"
                      value={String(draft.binding.sourceMode ?? "endpoint_group")}
                      disabled={frozen}
                      onChange={(e) => {
                        const mode = e.target.value as "endpoint_group" | "individual_device";
                        if (mode === "endpoint_group") {
                          setDraft({
                            ...draft,
                            binding: {
                              ...draft.binding,
                              sourceMode: "endpoint_group",
                              sourceType: "resolved_device_collection",
                              sourceId: "",
                              siteId: String(siteId ?? draft.binding.siteId ?? ""),
                            },
                          });
                          return;
                        }
                        setDraft({
                          ...draft,
                          binding: {
                            ...draft.binding,
                            sourceMode: "individual_device",
                            sourceType: "latest_device_state",
                            sourceId: "",
                          },
                        });
                      }}
                    >
                      <option value="endpoint_group">Endpoint Group (default)</option>
                      <option value="individual_device">Individual Device (advanced)</option>
                    </select>
                  </label>
                )}

                {needsSource && sourceMode === "endpoint_group" && (
                  <div className="dash-drawer__label">
                    Endpoint Group
                    <select
                      className="dash-drawer__input"
                      value={`${String(draft.binding.endpointId ?? "")}|${String(draft.binding.objectName ?? "")}`}
                      disabled={frozen || !siteId}
                      onChange={(e) => {
                        const [endpointId, objectName] = e.target.value.split("|");
                        setDraft({
                          ...draft,
                          binding: {
                            ...draft.binding,
                            sourceMode: "endpoint_group",
                            sourceType: "resolved_device_collection",
                            siteId: String(siteId ?? ""),
                            endpointId: endpointId || "",
                            objectName: objectName || "",
                            sourceId: "",
                          },
                        });
                      }}
                    >
                      <option value="">— Select endpoint + object —</option>
                      {collectionOptions.map((opt) => {
                        const v = `${opt.endpoint_id}|${opt.object_name}`;
                        const endpointLabel = opt.endpoint_name || opt.endpoint_id.slice(0, 8);
                        return (
                          <option key={v} value={v}>
                            {endpointLabel} · {opt.object_name} ({opt.resolved_device_count})
                          </option>
                        );
                      })}
                    </select>
                    <span className="dash-widget__muted" style={{ fontSize: "0.75rem" }}>
                      Site scope: {siteId ?? "Select site first"}
                    </span>
                  </div>
                )}

                {needsSource && sourceMode === "individual_device" && (
                  <label className="dash-drawer__label">
                    Source type
                    <select
                      className="dash-drawer__input"
                      value={(draft.binding.sourceType as string) || "latest_device_state"}
                      disabled={frozen}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          binding: {
                            ...draft.binding,
                            sourceMode: "individual_device",
                            sourceType: e.target.value as "result_object" | "latest_device_state",
                            sourceId: "",
                          },
                        })
                      }
                    >
                      <option value="result_object">result_object</option>
                      <option value="latest_device_state">latest_device_state</option>
                    </select>
                  </label>
                )}

                {needsSource && sourceMode === "individual_device" && (
                  <div className="dash-drawer__label">
                    Source
                    <DashboardSourceSelector
                      siteId={siteId}
                      sourceType={
                        (draft.binding.sourceType as "result_object" | "latest_device_state") ||
                        "latest_device_state"
                      }
                      value={String(draft.binding.sourceId ?? "")}
                      disabled={frozen}
                      onChange={(id) => setDraft({ ...draft, binding: { ...draft.binding, sourceId: id } })}
                    />
                  </div>
                )}

                <details className="dash-widget-config-advanced">
                  <summary>Advanced widget options</summary>
                  <DashboardBindingEditor widget={draft} onChange={setDraft} disabled={frozen} siteId={siteId} />
                </details>
              </section>

              <section className="dash-widget-config-col dash-widget-config-col--preview">
                <h3>Preview</h3>
                <div className="dash-widget-config-preview-pane">
                  {previewWidget ? (
                    <DashboardWidgetView block={previewWidget} />
                  ) : (
                    <p className="dash-widget__muted">Resolve preview…</p>
                  )}
                </div>
              </section>

              <section className="dash-widget-config-col dash-widget-config-col--debug">
                <h3>Debug JSON</h3>
                <div className="dash-widget-config-debug-pane">
                  <pre>{JSON.stringify(draft, null, 2)}</pre>
                </div>
              </section>
            </div>
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
