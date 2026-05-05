import { Fragment, useEffect, useMemo, useState } from "react";
import { useDashboardBuilderStore } from "@/stores/dashboardBuilderStore";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import { DashboardBindingEditor } from "./DashboardBindingEditor";
import { DashboardChartConfigSection } from "./DashboardChartConfigSection";
import * as dashApi from "@/api/dashboard";
import { DashboardWidgetView } from "./DashboardWidgetView";
import { inferDashboardSourceMode } from "@/lib/dashboard/inferDashboardSourceMode";
import { derivedMapTrackMode } from "@/lib/dashboard/mapWidgetTrack";
import { EndpointGroupPickerField, IndividualDevicePickerField } from "./DashboardSourcePickers";

function findWidget(
  layout: ReturnType<typeof useDashboardBuilderStore.getState>["layout"],
  rowId: string,
  columnId: string,
): DashboardWidgetModel | null {
  const row = layout.rows.find((r) => r.rowId === rowId);
  const col = row?.columns.find((c) => c.columnId === columnId);
  return col?.widget ?? null;
}

function humanizeWidgetType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  const [debugModalOpen, setDebugModalOpen] = useState(false);

  useEffect(() => {
    setDraft(base);
  }, [base, open, target?.rowId, target?.columnId]);

  useEffect(() => {
    if (!open) {
      setDebugModalOpen(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (debugModalOpen) {
          setDebugModalOpen(false);
          return;
        }
        closeDrawer();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDrawer, debugModalOpen]);

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

  const previewMarkers = previewWidget?.data?.markers;
  const previewMarkerCount = Array.isArray(previewMarkers) ? previewMarkers.length : null;
  const mapCfgRec = draft.type === "map" ? (draft.config as Record<string, unknown>) : {};
  const mapTrackStr =
    draft.type === "map" ? derivedMapTrackMode(mapCfgRec as Record<string, unknown>) : "site";
  const maxDirectVal =
    draft.type === "map" &&
    typeof mapCfgRec.maxDirectMarkers === "number" &&
    Number.isFinite(mapCfgRec.maxDirectMarkers as number)
      ? (mapCfgRec.maxDirectMarkers as number)
      : 80;

  const configWarnings: string[] = [];
  const bind = draft.binding;
  if (draft.type === "map") {
    const lat = String(bind.latitudeField ?? "gps.lat").trim();
    const lon = String(bind.longitudeField ?? "gps.lon").trim();
    if (!lat || !lon) configWarnings.push("Latitude or longitude field is empty.");
    const entries = Array.isArray(mapCfgRec.mapEndpointGroupEntries)
      ? (mapCfgRec.mapEndpointGroupEntries as Record<string, unknown>[])
      : [];
    const hasCompleteGroup = entries.some(
      (row) =>
        String(row.endpointId ?? row.endpoint_id ?? "").trim() &&
        String(row.objectName ?? row.object_name ?? "").trim(),
    );
    if (mapTrackStr === "endpoint_groups" && !hasCompleteGroup) {
      configWarnings.push("Endpoint groups mode requires at least one endpoint and object name.");
    }
    const manualMap =
      mapCfgRec.autoIncludeGpsObjects === false && mapTrackStr !== "endpoint_groups";
    const inc = mapCfgRec.includedSources as unknown[] | undefined;
    if (manualMap && (!inc || inc.length === 0)) {
      configWarnings.push("Manual map objects list is empty — select objects or turn auto-include back on.");
    }
    if (previewMarkerCount != null && previewMarkerCount > maxDirectVal && mapCfgRec.clusterMarkers === false) {
      configWarnings.push(
        `Preview shows ${previewMarkerCount} markers while clustering is off — may impact performance.`,
      );
    }
    if (mapCfgRec.autoFitOnFirstLoad === false && mapCfgRec.autoFitOnRefresh !== true) {
      configWarnings.push("Auto-fit on first load is off — verify map initial bounds or center.");
    }
  }
  if (
    needsSource &&
    sourceMode === "endpoint_group" &&
    !(String(bind.endpointId ?? "").trim() && String(bind.objectName ?? "").trim())
  ) {
    configWarnings.push("No endpoint group selected.");
  }
  if (needsSource && sourceMode === "individual_device" && !String(bind.sourceId ?? "").trim()) {
    configWarnings.push("No device / result object selected.");
  }
  if (draft.type === "chart" && !String(bind.yField ?? "").trim()) {
    configWarnings.push("Y axis field is empty.");
  }

  const summaryLines: { label: string; value: string }[] = [];
  summaryLines.push({ label: "Widget type", value: humanizeWidgetType(draft.type) });
  summaryLines.push({ label: "Title", value: draft.title?.trim() || "—" });
  summaryLines.push({ label: "Site", value: siteId || "—" });
  if (draft.type === "map") {
    const modeLabel =
      mapTrackStr === "site"
        ? "Site GPS (auto)"
        : mapTrackStr === "devices"
          ? "Selected devices"
          : "Endpoint groups";
    summaryLines.push({ label: "Map track mode", value: modeLabel });
    if (mapTrackStr === "endpoint_groups") {
      const rows = Array.isArray(mapCfgRec.mapEndpointGroupEntries)
        ? (mapCfgRec.mapEndpointGroupEntries as { endpointId?: string; objectName?: string }[])
        : [];
      const parts = rows
        .map((r) => {
          const e = String(r.endpointId ?? "").trim();
          const o = String(r.objectName ?? "").trim();
          return e && o ? `${e.slice(0, 10)}… / ${o}` : "";
        })
        .filter(Boolean);
      summaryLines.push({ label: "Endpoint groups", value: parts.length ? parts.join("; ") : "—" });
    }
    const devIds = mapCfgRec.mapDeviceIds as string[] | undefined;
    summaryLines.push({
      label: "Device filter",
      value:
        mapTrackStr === "devices" ? (devIds?.length ? `${devIds.length} selected` : "All devices") : "—",
    });
    summaryLines.push({
      label: "Aggregation",
      value: mapCfgRec.mapAggregateByDevice === true ? "One marker per device" : "Per feed",
    });
  } else if (needsSource) {
    summaryLines.push({
      label: "Source mode",
      value: sourceMode === "endpoint_group" ? "Endpoint group" : "Individual device",
    });
    if (sourceMode === "endpoint_group") {
      summaryLines.push({
        label: "Endpoint / object",
        value:
          bind.endpointId || bind.objectName
            ? `${String(bind.endpointId ?? "").slice(0, 10)}… / ${String(bind.objectName ?? "")}`
            : "—",
      });
    } else {
      summaryLines.push({
        label: "Source id",
        value: bind.sourceId ? `${String(bind.sourceId).slice(0, 12)}…` : "—",
      });
    }
  }
  if (draft.type === "chart") {
    summaryLines.push({ label: "Chart window", value: String(bind.chartTimeWindow ?? "—") });
    summaryLines.push({
      label: "X / Y fields",
      value: `${String(bind.xField ?? "—")} / ${String(bind.yField ?? "—")}`,
    });
  }

  const widgetPreviewAndSummary = (
    <>
      <h3 className="dash-widget-config-rail__h">Preview</h3>
      <div className="dash-widget-config-preview-pane dash-widget-config-preview-pane--rail">
        {previewWidgetNoTitle ? (
          <>
            <div className="dash-widget-config-preview-title">{draft.title || "Widget preview"}</div>
            <DashboardWidgetView block={previewWidgetNoTitle} />
          </>
        ) : (
          <p className="dash-widget__muted">Resolve preview…</p>
        )}
      </div>
      {draft.type === "map" && previewMarkerCount != null ? (
        <p className="dash-widget-config-rail__meta">Markers in preview payload: {previewMarkerCount}</p>
      ) : null}
      <h3 className="dash-widget-config-rail__h">Binding summary</h3>
      <dl className="dash-widget-config-dl">
        {summaryLines.map((row) => (
          <Fragment key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </Fragment>
        ))}
      </dl>
      <h3 className="dash-widget-config-rail__h">Warnings</h3>
      {configWarnings.length === 0 ? (
        <p className="dash-widget-config-rail__ok">No binding issues detected.</p>
      ) : (
        <ul className="dash-widget-config-warn">
          {configWarnings.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </>
  );

  const rightRail = (
    <aside className="dash-widget-config-shell__right" aria-label="Preview and binding summary">
      {widgetPreviewAndSummary}
    </aside>
  );

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
            <div className="dash-widget-config-shell">
              <div className="dash-widget-config-shell__left">
                <details className="dash-widget-config-accordion" open>
                  <summary className="dash-widget-config-accordion__summary">Basic</summary>
                  <div className="dash-widget-config-accordion__body">
                    <label className="dash-drawer__label">
                      Title
                      <input
                        className="dash-drawer__input"
                        value={draft.title}
                        disabled={frozen}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      />
                    </label>
                    <p className="dash-widget__muted dash-widget-config-readonly-type">
                      Widget type: <strong>{humanizeWidgetType(draft.type)}</strong>
                    </p>
                  </div>
                </details>

                <details className="dash-widget-config-accordion" open>
                  <summary className="dash-widget-config-accordion__summary">Data source</summary>
                  <div className="dash-widget-config-accordion__body">
                    <label className="dash-drawer__label">
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
                    <p className="dash-widget__muted dash-widget-config-accordion__hint">
                      <strong>Endpoint group</strong> uses the v2 endpoint’s stream <strong>object name</strong> (the{" "}
                      <code>endpoints.object_name</code> value — this is what <code>latest_device_state</code> rows use
                      after ingest, and it may differ from the scrubber UI label). <strong>Individual device</strong> picks one
                      device’s <code>latest_device_state</code> or <code>result_object</code>.
                    </p>
                    {sourceMode === "endpoint_group" ? (
                      <div className="dash-endpoint-group-field-wrap">
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
                  </div>
                </details>

                <details className="dash-widget-config-accordion" open>
                  <summary className="dash-widget-config-accordion__summary">Chart &amp; axes</summary>
                  <div className="dash-widget-config-accordion__body">
                    <DashboardChartConfigSection widget={draft} onChange={setDraft} disabled={frozen} />
                  </div>
                </details>

                <div className="dash-widget-config-advanced-launch">
                  <button type="button" className="dash-btn dash-btn--secondary" onClick={() => setDebugModalOpen(true)}>
                    Open debug JSON…
                  </button>
                </div>
              </div>
              {rightRail}
            </div>
          ) : draft.type === "map" ? (
            <div className="dash-widget-config-shell dash-widget-config-shell--map4">
              <DashboardBindingEditor
                widget={draft}
                onChange={setDraft}
                disabled={frozen}
                siteId={siteId}
                collectionOptions={collectionOptions}
                mapConfigureFourColumn
                mapBasicSlot={
                  <details className="dash-widget-config-accordion" open>
                    <summary className="dash-widget-config-accordion__summary">Basic</summary>
                    <div className="dash-widget-config-accordion__body">
                      <label className="dash-drawer__label">
                        Title
                        <input
                          className="dash-drawer__input"
                          value={draft.title}
                          disabled={frozen}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        />
                      </label>
                      <p className="dash-widget__muted dash-widget-config-readonly-type">
                        Widget type: <strong>{humanizeWidgetType(draft.type)}</strong>
                      </p>
                    </div>
                  </details>
                }
                mapPreviewColumn={
                  <div className="dash-widget-config-map4-preview-inner">{widgetPreviewAndSummary}</div>
                }
                mapCol1Footer={
                  <div className="dash-widget-config-advanced-launch">
                    <button type="button" className="dash-btn dash-btn--secondary" onClick={() => setDebugModalOpen(true)}>
                      Open debug JSON…
                    </button>
                  </div>
                }
              />
            </div>
          ) : (
            <div className="dash-widget-config-shell">
              <div className="dash-widget-config-shell__left">
                <details className="dash-widget-config-accordion" open>
                  <summary className="dash-widget-config-accordion__summary">Basic</summary>
                  <div className="dash-widget-config-accordion__body">
                    <label className="dash-drawer__label">
                      Title
                      <input
                        className="dash-drawer__input"
                        value={draft.title}
                        disabled={frozen}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      />
                    </label>
                    <p className="dash-widget__muted dash-widget-config-readonly-type">
                      Widget type: <strong>{humanizeWidgetType(draft.type)}</strong>
                    </p>
                  </div>
                </details>

                <DashboardBindingEditor
                  widget={draft}
                  onChange={setDraft}
                  disabled={frozen}
                  siteId={siteId}
                  collectionOptions={collectionOptions}
                />

                <div className="dash-widget-config-advanced-launch">
                  <button type="button" className="dash-btn dash-btn--secondary" onClick={() => setDebugModalOpen(true)}>
                    Open debug JSON…
                  </button>
                </div>
              </div>
              {rightRail}
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
      {debugModalOpen ? (
        <div
          className="dash-widget-config-debug-backdrop"
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
            setDebugModalOpen(false);
          }}
        >
          <div
            className="dash-widget-config-debug-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dash-config-debug-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="dash-widget-config-debug-modal__head">
              <h3 id="dash-config-debug-title">Advanced / Debug</h3>
              <button
                type="button"
                className="dash-drawer__close"
                aria-label="Close debug"
                onClick={() => setDebugModalOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="dash-widget-config-debug-modal__body">
              <p className="dash-widget__muted dash-widget-config-accordion__hint">
                Raw widget JSON for support and migrations.
              </p>
              <pre className="dash-widget-config-debug-modal__pre">{JSON.stringify(draft, null, 2)}</pre>
            </div>
            <footer className="dash-widget-config-debug-modal__foot">
              <button type="button" className="dash-btn dash-btn--accent" onClick={() => setDebugModalOpen(false)}>
                Close
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
