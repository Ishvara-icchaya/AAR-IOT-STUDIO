import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import { DashboardBindingEditor } from "./DashboardBindingEditor";
import { DashboardChartConfigSection } from "./DashboardChartConfigSection";
import * as dashApi from "@/api/dashboard";
import { DashboardWidgetView } from "./DashboardWidgetView";
import type { DashboardWidgetBinding } from "@/types/dashboardLayout";

/** Matches persisted bindings that omit `sourceMode` (infer from `sourceType` and ids). */
function inferDashboardSourceMode(b: DashboardWidgetBinding): "endpoint_group" | "individual_device" {
  if (b.sourceMode === "endpoint_group" || b.sourceMode === "individual_device") return b.sourceMode;
  const st = b.sourceType;
  if (st === "resolved_device_collection") return "endpoint_group";
  if (st === "latest_device_state" || st === "result_object" || st === "resolved_device_stream")
    return "individual_device";
  if (b.endpointId && b.objectName && !b.sourceId) return "endpoint_group";
  if (b.sourceId) return "individual_device";
  return "endpoint_group";
}

function findWidget(
  layout: ReturnType<typeof useDashboardBuilderStore.getState>["layout"],
  rowId: string,
  columnId: string,
): DashboardWidgetModel | null {
  const row = layout.rows.find((r) => r.rowId === rowId);
  const col = row?.columns.find((c) => c.columnId === columnId);
  return col?.widget ?? null;
}

/** Aligns dropdown text with Scrubber Pipelines (pipeline / device) while keeping technical binding visible. */
function formatEndpointGroupOptionLabel(opt: dashApi.ResolvedDeviceCollectionSourceItem): string {
  const endpointLabel = opt.endpoint_name || opt.endpoint_id.slice(0, 8);
  const count = opt.resolved_device_count;
  const core = `${endpointLabel} · ${opt.object_name} (${count})`;
  const pl = (opt.pipeline_label || "").trim();
  const dn = (opt.device_name || "").trim();
  if (dn) return `${dn} — ${core}`;
  if (pl) return `${pl} — ${core}`;
  return core;
}

function EndpointGroupPickerField({
  collectionOptions,
  endpointId,
  objectName,
  disabled,
  below,
  onCommit,
}: {
  collectionOptions: dashApi.ResolvedDeviceCollectionSourceItem[];
  endpointId: string;
  objectName: string;
  disabled: boolean;
  below?: ReactNode;
  onCommit: (endpointId: string, objectName: string) => void;
}) {
  const labelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectValue = `${String(endpointId ?? "")}|${String(objectName ?? "")}`;
  const selectedOpt = useMemo(
    () => collectionOptions.find((o) => `${o.endpoint_id}|${o.object_name}` === selectValue),
    [collectionOptions, selectValue],
  );
  const fullLabel = selectedOpt
    ? formatEndpointGroupOptionLabel(selectedOpt)
    : selectValue && selectValue !== "|"
      ? `${endpointId || "…"} · ${objectName || "…"}`
      : "";

  const displayText = fullLabel || "— Select endpoint + object —";

  function openDialog() {
    if (disabled) return;
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <div className="dash-endpoint-group-field">
      <span className="dash-drawer__label" id={labelId}>
        Endpoint Group
      </span>
      <button
        type="button"
        className="dash-endpoint-group-display dash-drawer__input"
        disabled={disabled}
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-labelledby={labelId}
        title={fullLabel ? `Open full name: ${fullLabel}` : "Choose endpoint group"}
      >
        <span className="dash-endpoint-group-display__text">{displayText}</span>
      </button>
      {below}
      <dialog
        ref={dialogRef}
        className="dash-endpoint-group-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
      >
        <div className="dash-endpoint-group-dialog__panel" onClick={(e) => e.stopPropagation()}>
          <h3 className="dash-endpoint-group-dialog__title">Endpoint group</h3>
          <p className="dash-endpoint-group-dialog__hint">Full name (same as in the dropdown list)</p>
          <div className="dash-endpoint-group-dialog__full" role="region" aria-label="Full endpoint group name">
            {fullLabel ? fullLabel : <span className="dash-widget__muted">No selection yet</span>}
          </div>
          <label className="dash-drawer__label dash-endpoint-group-dialog__select-label dash-endpoint-group-dialog__select-label--compact">
            Change selection
            <div className="dash-endpoint-group-dialog__select-wrap">
              <select
                className="dash-drawer__input dash-endpoint-group-dialog__select"
                value={selectValue}
                disabled={disabled}
                onChange={(e) => {
                  const [eid, oname] = e.target.value.split("|");
                  onCommit(eid || "", oname || "");
                }}
              >
                <option value="">— Select endpoint + object —</option>
                {collectionOptions.map((opt) => {
                  const v = `${opt.endpoint_id}|${opt.object_name}`;
                  return (
                    <option key={v} value={v}>
                      {formatEndpointGroupOptionLabel(opt)}
                    </option>
                  );
                })}
              </select>
            </div>
          </label>
          <div className="dash-endpoint-group-dialog__actions">
            <button type="button" className="dash-btn dash-btn--accent" onClick={closeDialog}>
              Done
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function formatLatestDeviceStateRowLabel(x: dashApi.LatestDeviceStateSourceItem): string {
  const name =
    (x.device_name && x.device_name.trim()) ||
    (x.device_label && x.device_label.trim()) ||
    (x.endpoint_name && x.endpoint_name.trim()) ||
    "";
  const tail = `${x.object_name} · ${x.id.slice(0, 8)}…`;
  return name ? `${name} — ${tail}` : tail;
}

function IndividualDevicePickerField({
  siteId,
  sourceType,
  sourceId,
  disabled,
  onCommit,
}: {
  siteId: string | null;
  sourceType: "latest_device_state" | "result_object";
  sourceId: string;
  disabled: boolean;
  onCommit: (sourceType: "latest_device_state" | "result_object", sourceId: string) => void;
}) {
  const labelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [ldsItems, setLdsItems] = useState<dashApi.LatestDeviceStateSourceItem[]>([]);
  const [roItems, setRoItems] = useState<dashApi.ResultObjectSourceItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!siteId) {
      setLdsItems([]);
      setRoItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        if (sourceType === "latest_device_state") {
          const r = await dashApi.listDashboardLatestDeviceStateSources(siteId);
          if (cancelled) return;
          setLdsItems(r?.items ?? []);
          setRoItems([]);
        } else {
          const r = await dashApi.listDashboardResultObjectSources(siteId);
          if (cancelled) return;
          setRoItems(r?.items ?? []);
          setLdsItems([]);
        }
      } catch {
        if (!cancelled) {
          setLdsItems([]);
          setRoItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, sourceType]);

  const selectedLds = useMemo(
    () => ldsItems.find((x) => x.id === sourceId),
    [ldsItems, sourceId],
  );
  const selectedRo = useMemo(() => roItems.find((x) => x.id === sourceId), [roItems, sourceId]);

  const fullLabel =
    sourceType === "latest_device_state"
      ? selectedLds
        ? formatLatestDeviceStateRowLabel(selectedLds)
        : sourceId
          ? `${sourceId.slice(0, 8)}…`
          : ""
      : selectedRo
        ? `${selectedRo.result_object_name} (${selectedRo.id.slice(0, 8)}…)`
        : sourceId
          ? `${sourceId.slice(0, 8)}…`
          : "";

  const displayText =
    fullLabel ||
    (sourceType === "latest_device_state" ? "— Select device stream —" : "— Select result object —");

  function openDialog() {
    if (disabled) return;
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <div className="dash-endpoint-group-field">
      <span className="dash-drawer__label" id={labelId}>
        Source
      </span>
      <button
        type="button"
        className="dash-endpoint-group-display dash-drawer__input"
        disabled={disabled || !siteId}
        onClick={openDialog}
        aria-haspopup="dialog"
        aria-labelledby={labelId}
        title={fullLabel ? `Open: ${fullLabel}` : "Choose source"}
      >
        <span className="dash-endpoint-group-display__text">{displayText}</span>
      </button>
      <dialog
        ref={dialogRef}
        className="dash-endpoint-group-dialog dash-individual-device-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
      >
        <div className="dash-endpoint-group-dialog__panel" onClick={(e) => e.stopPropagation()}>
          <h3 className="dash-endpoint-group-dialog__title">Individual device</h3>
          <p className="dash-endpoint-group-dialog__hint">
            Binding stores the row id (<code>latest_device_state</code> or <code>result_object</code>). The button shows the
            device or result name.
          </p>
          <div className="dash-endpoint-group-dialog__full" role="region" aria-label="Full source description">
            {fullLabel ? fullLabel : <span className="dash-widget__muted">No selection yet</span>}
          </div>
          <label className="dash-drawer__label dash-endpoint-group-dialog__select-label dash-endpoint-group-dialog__select-label--compact">
            Source type
            <div className="dash-endpoint-group-dialog__select-wrap">
              <select
                className="dash-drawer__input dash-endpoint-group-dialog__select"
                value={sourceType}
                disabled={disabled}
                onChange={(e) => {
                  const st = e.target.value as "latest_device_state" | "result_object";
                  onCommit(st, "");
                }}
              >
                <option value="latest_device_state">latest_device_state</option>
                <option value="result_object">result_object</option>
              </select>
            </div>
          </label>
          <label className="dash-drawer__label dash-endpoint-group-dialog__select-label dash-endpoint-group-dialog__select-label--compact">
            Change selection
            <div className="dash-endpoint-group-dialog__select-wrap">
              <select
                className="dash-drawer__input dash-endpoint-group-dialog__select"
                value={sourceId}
                disabled={disabled || loading}
                onChange={(e) => onCommit(sourceType, e.target.value)}
              >
                <option value="">— Select —</option>
                {sourceType === "latest_device_state"
                  ? ldsItems.map((x) => (
                      <option key={x.id} value={x.id}>
                        {formatLatestDeviceStateRowLabel(x)}
                      </option>
                    ))
                  : roItems.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.result_object_name} ({x.id.slice(0, 8)}…)
                      </option>
                    ))}
              </select>
            </div>
          </label>
          <div className="dash-endpoint-group-dialog__actions">
            <button type="button" className="dash-btn dash-btn--accent" onClick={closeDialog}>
              Done
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
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
  const previewWidgetNoTitle = previewWidget
    ? {
        ...previewWidget,
        config: {
          ...(previewWidget.config ?? {}),
          presentation: {
            ...((previewWidget.config as { presentation?: Record<string, unknown> } | undefined)?.presentation ?? {}),
            showTitle: false,
          },
        },
      }
    : null;

  const isChart = draft.type === "chart";
  const sourceMode = inferDashboardSourceMode(draft.binding);

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
              <p className="dash-widget__muted dash-chart-config-flow__row" style={{ fontSize: "0.78rem", lineHeight: 1.45 }}>
                <strong>Endpoint group</strong> uses the v2 endpoint’s stream <strong>object name</strong> (the{" "}
                <code>endpoints.object_name</code> value — this is what <code>latest_device_state</code> rows use after
                ingest, and it may differ from the scrubber UI label). <strong>Individual device</strong> picks one device’s{" "}
                <code>latest_device_state</code> or <code>result_object</code>. If ingest runs but the dashboard stays
                empty, confirm v2 identity is published, primary keys are set on the endpoint, and worker logs are not
                skipping v2 writes.
              </p>

              {sourceMode === "endpoint_group" ? (
                <div className="dash-chart-config-flow__row dash-endpoint-group-field-wrap">
                  <EndpointGroupPickerField
                    collectionOptions={collectionOptions}
                    endpointId={String(draft.binding.endpointId ?? "")}
                    objectName={String(draft.binding.objectName ?? "")}
                    disabled={frozen || !siteId}
                    onCommit={(endpointId, objectName) =>
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
                      })
                    }
                  />
                </div>
              ) : (
                <div className="dash-chart-config-flow__row dash-endpoint-group-field-wrap">
                  <IndividualDevicePickerField
                    siteId={siteId}
                    sourceType={
                      (draft.binding.sourceType as "result_object" | "latest_device_state") ||
                      "latest_device_state"
                    }
                    sourceId={String(draft.binding.sourceId ?? "")}
                    disabled={frozen || !siteId}
                    onCommit={(st, id) =>
                      setDraft({
                        ...draft,
                        binding: {
                          ...draft.binding,
                          sourceMode: "individual_device",
                          sourceType: st,
                          sourceId: id,
                        },
                      })
                    }
                  />
                </div>
              )}

              <div className="dash-chart-config-flow__row dash-chart-config-flow__row--axes">
                <DashboardChartConfigSection widget={draft} onChange={setDraft} disabled={frozen} />
              </div>

              <section className="dash-drawer__preview dash-chart-config-flow__row dash-chart-config-flow__row--preview">
                <h3>Chart preview</h3>
                {previewWidgetNoTitle ? (
                  <>
                    <div className="dash-widget-config-preview-title">{draft.title || "Widget preview"}</div>
                    <DashboardWidgetView block={previewWidgetNoTitle} />
                  </>
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
                      value={sourceMode}
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
                {needsSource ? (
                  <p className="dash-widget__muted" style={{ fontSize: "0.78rem", lineHeight: 1.45, marginTop: "0.15rem" }}>
                    <strong>Endpoint group</strong> binds to <code>endpoints.object_name</code> for that endpoint (same
                    string stored on <code>latest_device_state</code> after successful v2 resolution — it may differ from the
                    scrubber pipeline title). <strong>Individual device</strong> picks one <code>latest_device_state</code> or{" "}
                    <code>result_object</code>. If data is ingesting but widgets stay empty, check v2 identity publish,
                    primary-device-key fields, and Kafka <code>endpoint_id</code> on scrubber envelopes.
                  </p>
                ) : null}

                {needsSource && sourceMode === "endpoint_group" && (
                  <EndpointGroupPickerField
                    collectionOptions={collectionOptions}
                    endpointId={String(draft.binding.endpointId ?? "")}
                    objectName={String(draft.binding.objectName ?? "")}
                    disabled={frozen || !siteId}
                    below={
                      <span className="dash-widget__muted" style={{ fontSize: "0.75rem" }}>
                        Site scope: {siteId ?? "Select site first"}
                      </span>
                    }
                    onCommit={(endpointId, objectName) =>
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
                      })
                    }
                  />
                )}

                {needsSource && sourceMode === "individual_device" && (
                  <div className="dash-endpoint-group-field-wrap">
                    <IndividualDevicePickerField
                      siteId={siteId}
                      sourceType={
                        (draft.binding.sourceType as "result_object" | "latest_device_state") ||
                        "latest_device_state"
                      }
                      sourceId={String(draft.binding.sourceId ?? "")}
                      disabled={frozen || !siteId}
                      onCommit={(st, id) =>
                        setDraft({
                          ...draft,
                          binding: {
                            ...draft.binding,
                            sourceMode: "individual_device",
                            sourceType: st,
                            sourceId: id,
                          },
                        })
                      }
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
                  {previewWidgetNoTitle ? (
                    <>
                      <div className="dash-widget-config-preview-title">{draft.title || "Widget preview"}</div>
                      <DashboardWidgetView block={previewWidgetNoTitle} />
                    </>
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
