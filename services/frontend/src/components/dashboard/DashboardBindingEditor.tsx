import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getLatestDeviceStateFieldMetadata,
  getResultObjectFieldMetadata,
  type PayloadFieldEntry,
} from "@/api/fieldMetadata";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import * as dashApi from "@/api/dashboard";
import { listDevices, type DeviceRead } from "@/api/devices";
import { listEndpoints, type EndpointRead } from "@/api/endpoints";
import {
  EndpointGroupPickerField,
  formatEndpointGroupOptionLabel,
  IndividualDevicePickerField,
} from "./DashboardSourcePickers";
import { inferDashboardSourceMode } from "@/lib/dashboard/inferDashboardSourceMode";
import {
  mergeMapLayerControls,
  type MapLayerColorMode,
  type MapLayerControls,
  type MapLayerFilterMode,
} from "@/lib/dashboard/mapLayerControls";
import {
  derivedMapTrackMode,
  mapEndpointRowComplete,
  mapEndpointRows,
  normalizeMapEndpointEntries,
} from "@/lib/dashboard/mapWidgetTrack";

type FieldPathPickerProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  meta: PayloadFieldEntry[];
  loading: boolean;
  disabled?: boolean;
};

function FieldPathPicker({ label, value, onChange, meta, loading, disabled }: FieldPathPickerProps) {
  const optVals = meta.map((m) => m.path);
  const known = Boolean(value && optVals.includes(value));
  return (
    <label className="dash-drawer__label">
      {label}
      {loading ? (
        <span className="dash-widget__muted" style={{ fontSize: "0.78rem" }}>
          Loading fields…
        </span>
      ) : null}
      <select
        className="dash-drawer__input"
        disabled={disabled || meta.length === 0}
        value={known ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{meta.length ? "Select…" : "No fields (use advanced)"}</option>
        {meta.map((m) => (
          <option key={m.path} value={m.path}>
            {m.path} ({m.type})
          </option>
        ))}
      </select>
      <details style={{ marginTop: "0.35rem" }}>
        <summary className="dash-widget__muted" style={{ cursor: "pointer", fontSize: "0.82rem" }}>
          Advanced path
        </summary>
        <input
          className="dash-drawer__input"
          style={{ marginTop: "0.25rem" }}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. metrics.temp.value"
        />
      </details>
    </label>
  );
}

type Props = {
  widget: DashboardWidgetModel;
  onChange: (next: DashboardWidgetModel) => void;
  disabled?: boolean;
  /** Dashboard site — map: eligible sources when auto GPS is off; device filter when auto GPS is on. */
  siteId?: string | null;
  /** Resolved endpoint groups for KPI/table/device/chart source pickers (builder preloads). */
  collectionOptions?: dashApi.ResolvedDeviceCollectionSourceItem[];
  /** Map widget: four-column configure layout (drawer supplies basic + preview slots). */
  mapConfigureFourColumn?: boolean;
  mapBasicSlot?: ReactNode;
  mapPreviewColumn?: ReactNode;
  mapCol1Footer?: ReactNode;
};

export function DashboardBindingEditor({
  widget,
  onChange,
  disabled,
  siteId,
  collectionOptions = [],
  mapConfigureFourColumn = false,
  mapBasicSlot = null,
  mapPreviewColumn = null,
  mapCol1Footer = null,
}: Props) {
  const b = widget.binding;
  const c = widget.config;

  function patchBinding(partial: Record<string, unknown>) {
    onChange({ ...widget, binding: { ...widget.binding, ...partial } });
  }

  function patchConfig(partial: Record<string, unknown>) {
    onChange({ ...widget, config: { ...widget.config, ...partial } });
  }

  function parseList(s: string): string[] {
    return s
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  const needsSource = !["text", "health_summary", "alert_summary", "site_summary"].includes(widget.type);
  const mapAuto = widget.type === "map" && (c.autoIncludeGpsObjects !== false);
  const mapTrackUi = useMemo(
    () => derivedMapTrackMode(c as Record<string, unknown>),
    [c.mapTrackMode, c.mapEndpointGroupEntries, c.mapDeviceIds],
  );
  const sourceMode = inferDashboardSourceMode(widget.binding);
  const layerControls = mergeMapLayerControls(c.mapLayerControls);

  function patchMapLayerControls(partial: Partial<MapLayerControls>) {
    patchConfig({ mapLayerControls: mergeMapLayerControls({ ...layerControls, ...partial }) });
  }

  const [eligibleMap, setEligibleMap] = useState<dashApi.MapEligibleItem[]>([]);
  const [mapSiteDevices, setMapSiteDevices] = useState<DeviceRead[]>([]);
  const [mapSiteEndpoints, setMapSiteEndpoints] = useState<EndpointRead[]>([]);
  const sourceIdBind = String(b.sourceId ?? "").trim();
  const sourceTypeBind = (b.sourceType as string) || "latest_device_state";
  const [fieldMeta, setFieldMeta] = useState<PayloadFieldEntry[]>([]);
  const [fieldMetaLoading, setFieldMetaLoading] = useState(false);
  const [mapDeviceFilter, setMapDeviceFilter] = useState("");
  const [mapEligibleFilter, setMapEligibleFilter] = useState("");
  const [epGroupFilter, setEpGroupFilter] = useState("");

  useEffect(() => {
    const needsMeta =
      Boolean(sourceIdBind) &&
      (widget.type === "kpi" ||
        widget.type === "table" ||
        widget.type === "map" ||
        widget.type === "device_tile");
    if (!needsMeta) {
      setFieldMeta([]);
      return;
    }
    let cancelled = false;
    setFieldMetaLoading(true);
    void (async () => {
      try {
        const res =
          sourceTypeBind === "latest_device_state" || sourceTypeBind === "device_state"
              ? await getLatestDeviceStateFieldMetadata(sourceIdBind)
              : await getResultObjectFieldMetadata(sourceIdBind);
        if (!cancelled) setFieldMeta(res?.items ?? []);
      } catch {
        if (!cancelled) setFieldMeta([]);
      } finally {
        if (!cancelled) setFieldMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceIdBind, sourceTypeBind, widget.type]);

  useEffect(() => {
    if (widget.type !== "map" || mapAuto || !siteId) {
      setEligibleMap([]);
      return;
    }
    let cancelled = false;
    void dashApi
      .listMapEligibleObjects(siteId)
      .then((r) => {
        if (!cancelled && r) setEligibleMap(r.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setEligibleMap([]);
      });
    return () => {
      cancelled = true;
    };
  }, [widget.type, mapAuto, siteId]);

  useEffect(() => {
    if (widget.type !== "map" || !siteId) {
      setMapSiteEndpoints([]);
      return;
    }
    let cancelled = false;
    void listEndpoints({ site_id: siteId })
      .then((r) => {
        if (!cancelled) setMapSiteEndpoints(r?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setMapSiteEndpoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [widget.type, siteId]);

  useEffect(() => {
    if (widget.type !== "map" || !mapAuto || !siteId) {
      setMapSiteDevices([]);
      return;
    }
    let cancelled = false;
    void listDevices({ site_id: siteId })
      .then((items) => {
        if (!cancelled) setMapSiteDevices(items);
      })
      .catch(() => {
        if (!cancelled) setMapSiteDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [widget.type, mapAuto, siteId]);

  function toggleIncluded(item: dashApi.MapEligibleItem) {
    const raw = (c.includedSources as Array<{ sourceType: string; sourceId: string }>) ?? [];
    const exists = raw.some((x) => x.sourceType === item.source_type && x.sourceId === item.source_id);
    const next = exists
      ? raw.filter((x) => !(x.sourceType === item.source_type && x.sourceId === item.source_id))
      : [...raw, { sourceType: item.source_type, sourceId: item.source_id }];
    patchConfig({ includedSources: next });
  }

  function toggleCollectionOpt(opt: dashApi.ResolvedDeviceCollectionSourceItem) {
    const norm = normalizeMapEndpointEntries(mapEndpointRows(c as Record<string, unknown>));
    const ix = norm.findIndex((e) => e.endpointId === opt.endpoint_id && e.objectName === opt.object_name);
    const next = ix >= 0 ? norm.filter((_, i) => i !== ix) : [...norm, { endpointId: opt.endpoint_id, objectName: opt.object_name }];
    const meaningful = next.filter((e) => e.endpointId.trim() && e.objectName.trim());
    if (!meaningful.length) {
      patchConfig({ mapEndpointGroupEntries: [], mapTrackMode: "site", autoIncludeGpsObjects: true });
      return;
    }
    patchConfig({ mapEndpointGroupEntries: next, mapTrackMode: "endpoint_groups", autoIncludeGpsObjects: false });
  }

  function patchEndpointGroupRows(rows: Record<string, unknown>[]) {
    const anyComplete = rows.some((r) => mapEndpointRowComplete(r));
    patchConfig({
      mapEndpointGroupEntries: rows,
      ...(anyComplete ? { mapTrackMode: "endpoint_groups", autoIncludeGpsObjects: false } : {}),
    });
  }

  function renderMapDataSourceAccordion() {
    if (!needsSource || widget.type !== "map") return null;
    return (
      <details className="dash-widget-config-accordion" open>
        <summary className="dash-widget-config-accordion__summary">Data source</summary>
        <div className="dash-widget-config-accordion__body">
          <label className="dash-drawer__label dash-drawer__check">
            <input
              type="checkbox"
              checked={c.autoIncludeGpsObjects !== false}
              disabled={disabled}
              onChange={(e) => patchConfig({ autoIncludeGpsObjects: e.target.checked })}
            />
            Auto-include all GPS-capable objects for this site
          </label>

          {c.autoIncludeGpsObjects !== false && (
            <label className="dash-drawer__label">
              Excluded source IDs (comma-separated)
              <input
                className="dash-drawer__input"
                value={(c.excludedSourceIds as string[])?.join(", ") ?? ""}
                disabled={disabled}
                onChange={(e) => patchConfig({ excludedSourceIds: parseList(e.target.value) })}
              />
            </label>
          )}

          {mapAuto && siteId && mapTrackUi !== "endpoint_groups" && (
            <div className="dash-drawer__label">
              <span className="dash-widget__muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                Devices on map — leave all unchecked for every device; check to limit markers
              </span>
              <input
                className="dash-drawer__input dash-widget-config-msfilter"
                placeholder="Filter devices…"
                value={mapDeviceFilter}
                disabled={disabled}
                onChange={(e) => setMapDeviceFilter(e.target.value)}
                aria-label="Filter device list"
              />
              <div className="dash-widget-config-msgrid">
                {mapSiteDevices.length === 0 ? (
                  <span className="dash-widget__muted">No devices or loading…</span>
                ) : (
                  mapSiteDevices
                    .filter((d) => {
                      const q = mapDeviceFilter.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        (d.name ?? "").toLowerCase().includes(q) ||
                        d.id.toLowerCase().includes(q)
                      );
                    })
                    .map((d) => {
                      const allowed = (c.mapDeviceIds as string[] | undefined) ?? [];
                      const allIds = mapSiteDevices.map((x) => x.id);
                      const restrict = allowed.length > 0;
                      const checked = !restrict || allowed.includes(d.id);
                      return (
                        <label key={d.id} className="dash-widget-config-msgrid__chk">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => {
                              const cur = (c.mapDeviceIds as string[] | undefined) ?? [];
                              let nextIds: string[];
                              if (!restrict) {
                                nextIds = allIds.filter((id) => id !== d.id);
                              } else if (cur.includes(d.id)) {
                                nextIds = cur.filter((id) => id !== d.id);
                              } else {
                                const cand = [...cur, d.id];
                                const setNext = new Set(cand);
                                nextIds =
                                  allIds.length > 0 && allIds.every((id) => setNext.has(id)) ? [] : cand;
                              }
                              patchConfig({
                                mapDeviceIds: nextIds,
                                mapTrackMode: nextIds.length > 0 ? "devices" : "site",
                              });
                            }}
                          />
                          <span className="dash-widget-config-msgrid__lbl">
                            {d.name}{" "}
                            <span className="dash-widget__muted">({d.id.slice(0, 8)}…)</span>
                          </span>
                        </label>
                      );
                    })
                )}
              </div>
            </div>
          )}

          {!mapAuto && siteId && mapTrackUi !== "endpoint_groups" && (
            <div className="dash-drawer__label">
              <span className="dash-widget__muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                Map objects (eligible — multiselect)
              </span>
              <input
                className="dash-drawer__input dash-widget-config-msfilter"
                placeholder="Filter objects…"
                value={mapEligibleFilter}
                disabled={disabled}
                onChange={(e) => setMapEligibleFilter(e.target.value)}
                aria-label="Filter eligible map objects"
              />
              <div className="dash-widget-config-msgrid">
                {eligibleMap.length === 0 ? (
                  <span className="dash-widget__muted">No eligible objects or loading…</span>
                ) : (
                  eligibleMap
                    .filter((item) => {
                      const q = mapEligibleFilter.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        (item.name ?? "").toLowerCase().includes(q) ||
                        item.source_id.toLowerCase().includes(q) ||
                        (item.source_type ?? "").toLowerCase().includes(q)
                      );
                    })
                    .map((item) => {
                      const checked = (
                        (c.includedSources as Array<{ sourceType: string; sourceId: string }>) ?? []
                      ).some((x) => x.sourceType === item.source_type && x.sourceId === item.source_id);
                      return (
                        <label key={`${item.source_type}:${item.source_id}`} className="dash-widget-config-msgrid__chk">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleIncluded(item)}
                          />
                          <span className="dash-widget-config-msgrid__lbl">
                            {item.name}{" "}
                            <span className="dash-widget__muted">
                              ({item.source_type} · {item.source_id.slice(0, 8)}…)
                            </span>
                          </span>
                        </label>
                      );
                    })
                )}
              </div>
            </div>
          )}

          {!mapAuto && (
            <p className="dash-widget__muted" style={{ fontSize: "0.8rem" }}>
              Pick a source below. Required when auto GPS is off.
            </p>
          )}

          {siteId ? (
            <div className="dash-widget-config-track-line">
              <span className="dash-widget__muted">Mode:</span>{" "}
              <strong>
                {mapTrackUi === "endpoint_groups"
                  ? "Endpoint groups"
                  : mapTrackUi === "devices"
                    ? "Filtered devices"
                    : "Site GPS"}
              </strong>
              <span className="dash-widget-config-track-line__actions">
                {mapTrackUi === "endpoint_groups" ? (
                  <button
                    type="button"
                    className="dash-link"
                    disabled={disabled}
                    onClick={() =>
                      patchConfig({
                        mapTrackMode: "site",
                        mapEndpointGroupEntries: [],
                        autoIncludeGpsObjects: true,
                        mapDeviceIds: [],
                      })
                    }
                  >
                    Use site GPS
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dash-link"
                    disabled={disabled}
                    onClick={() =>
                      patchConfig({
                        mapTrackMode: "endpoint_groups",
                        autoIncludeGpsObjects: false,
                        mapEndpointGroupEntries: [{ endpointId: "", objectName: "" }],
                      })
                    }
                  >
                    Use endpoint groups…
                  </button>
                )}
              </span>
            </div>
          ) : null}
          {mapTrackUi === "endpoint_groups" && siteId ? (
            collectionOptions.length > 0 ? (
              <div className="dash-drawer__label">
                <span className="dash-widget__muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  Endpoint groups (multi-select)
                </span>
                <input
                  className="dash-drawer__input dash-widget-config-msfilter"
                  placeholder="Filter groups…"
                  value={epGroupFilter}
                  disabled={disabled}
                  onChange={(e) => setEpGroupFilter(e.target.value)}
                  aria-label="Filter endpoint groups"
                />
                <div className="dash-widget-config-msgrid">
                  {collectionOptions
                    .filter((opt) => {
                      const q = epGroupFilter.trim().toLowerCase();
                      if (!q) return true;
                      return formatEndpointGroupOptionLabel(opt).toLowerCase().includes(q);
                    })
                    .map((opt) => {
                      const norm = normalizeMapEndpointEntries(
                        mapEndpointRows(c as Record<string, unknown>),
                      );
                      const checked = norm.some(
                        (e) => e.endpointId === opt.endpoint_id && e.objectName === opt.object_name,
                      );
                      return (
                        <label key={`${opt.endpoint_id}|${opt.object_name}`} className="dash-widget-config-msgrid__chk">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleCollectionOpt(opt)}
                          />
                          <span className="dash-widget-config-msgrid__lbl" title={formatEndpointGroupOptionLabel(opt)}>
                            {formatEndpointGroupOptionLabel(opt)}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="dash-drawer__label">
                <span className="dash-widget__muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                  Endpoint groups (one or more)
                </span>
                {(Array.isArray(c.mapEndpointGroupEntries)
                  ? (c.mapEndpointGroupEntries as Record<string, unknown>[])
                  : []
                ).map((row, idx) => {
                  const eid = String(row.endpointId ?? row.endpoint_id ?? "");
                  const oname = String(row.objectName ?? row.object_name ?? "");
                  return (
                    <div
                      key={`meg-${idx}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr auto",
                        gap: "0.35rem",
                        marginBottom: "0.35rem",
                        alignItems: "end",
                      }}
                    >
                      <label style={{ fontSize: "0.8rem" }}>
                        Endpoint
                        <select
                          className="dash-drawer__input"
                          disabled={disabled}
                          value={eid}
                          onChange={(ev) => {
                            const rows = [
                              ...(Array.isArray(c.mapEndpointGroupEntries)
                                ? (c.mapEndpointGroupEntries as Record<string, unknown>[])
                                : []),
                            ];
                            rows[idx] = { ...rows[idx], endpointId: ev.target.value };
                            patchEndpointGroupRows(rows);
                          }}
                        >
                          <option value="">Select…</option>
                          {mapSiteEndpoints.map((ep) => (
                            <option key={ep.id} value={ep.id}>
                              {ep.endpoint_name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ fontSize: "0.8rem" }}>
                        Object name
                        <input
                          className="dash-drawer__input"
                          disabled={disabled}
                          value={oname}
                          placeholder="e.g. vehicle"
                          onChange={(ev) => {
                            const rows = [
                              ...(Array.isArray(c.mapEndpointGroupEntries)
                                ? (c.mapEndpointGroupEntries as Record<string, unknown>[])
                                : []),
                            ];
                            rows[idx] = { ...rows[idx], objectName: ev.target.value };
                            patchEndpointGroupRows(rows);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className="dash-drawer__input"
                        style={{ padding: "0.15rem 0.35rem", cursor: "pointer" }}
                        disabled={disabled}
                        title="Remove group"
                        onClick={() => {
                          const rows = [
                            ...(Array.isArray(c.mapEndpointGroupEntries)
                              ? (c.mapEndpointGroupEntries as Record<string, unknown>[])
                              : []),
                          ];
                          rows.splice(idx, 1);
                          if (!rows.length) {
                            patchConfig({
                              mapEndpointGroupEntries: [],
                              mapTrackMode: "site",
                              autoIncludeGpsObjects: true,
                            });
                            return;
                          }
                          patchEndpointGroupRows(rows);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="dash-drawer__input"
                  style={{ marginTop: "0.25rem", padding: "0.25rem 0.5rem", cursor: "pointer" }}
                  disabled={disabled}
                  onClick={() => {
                    const rows = [
                      ...(Array.isArray(c.mapEndpointGroupEntries)
                        ? (c.mapEndpointGroupEntries as Record<string, unknown>[])
                        : []),
                    ];
                  patchEndpointGroupRows([...rows, { endpointId: "", objectName: "" }]);
                }}
              >
                + Add group
              </button>
              </div>
            )
          ) : null}
        </div>
      </details>
    );
  }

  function renderMapBehaviorAccordion() {
    if (widget.type !== "map") return null;
    return (
      <details className="dash-widget-config-accordion" open>
        <summary className="dash-widget-config-accordion__summary">Map behavior</summary>
        <div className="dash-widget-config-accordion__body">
          <div className="dash-widget-config-grid-behavior">
            <label className="dash-widget-config-behavior__cell dash-drawer__label dash-drawer__check">
              <input
                type="checkbox"
                checked={c.mapAggregateByDevice === true}
                disabled={disabled}
                onChange={(e) => patchConfig({ mapAggregateByDevice: e.target.checked })}
              />
              <span>One marker per device</span>
            </label>
            <label className="dash-widget-config-behavior__cell dash-drawer__label dash-drawer__check">
              <input
                type="checkbox"
                checked={c.mapSmoothMarkers !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ mapSmoothMarkers: e.target.checked })}
              />
              <span>Smooth marker motion</span>
            </label>
            <label className="dash-widget-config-behavior__cell dash-drawer__label dash-drawer__check">
              <input
                type="checkbox"
                checked={c.clusterMarkers !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ clusterMarkers: e.target.checked })}
              />
              <span>Cluster markers</span>
            </label>
            <label className="dash-widget-config-behavior__cell dash-drawer__label dash-drawer__check">
              <input
                type="checkbox"
                checked={c.autoFitOnFirstLoad !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ autoFitOnFirstLoad: e.target.checked })}
              />
              <span>Auto-fit on first load</span>
            </label>
            <label className="dash-widget-config-behavior__cell dash-drawer__label dash-drawer__check">
              <input
                type="checkbox"
                checked={c.autoFitOnRefresh === true}
                disabled={disabled}
                onChange={(e) => patchConfig({ autoFitOnRefresh: e.target.checked })}
              />
              <span>Auto-fit on refresh</span>
            </label>
            <label className="dash-widget-config-behavior__cell dash-drawer__label dash-drawer__check">
              <input
                type="checkbox"
                checked={c.preserveViewport !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ preserveViewport: e.target.checked })}
              />
              <span>Preserve viewport</span>
            </label>
          </div>
          <label className="dash-drawer__label dash-widget-config-maxdirect">
            Max direct markers before forcing clusters
            <input
              className="dash-drawer__input"
              type="number"
              min={10}
              max={500}
              value={typeof c.maxDirectMarkers === "number" ? c.maxDirectMarkers : 80}
              disabled={disabled}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                patchConfig({ maxDirectMarkers: Number.isFinite(n) ? n : 80 });
              }}
            />
          </label>
        </div>
      </details>
    );
  }

  function renderMapDisplayAccordion() {
    if (widget.type !== "map") return null;
    return (
      <details className="dash-widget-config-accordion" open>
        <summary className="dash-widget-config-accordion__summary">Display &amp; layers</summary>
        <div className="dash-widget-config-accordion__body">
          <fieldset className="dash-widget-config-accordion__fieldset">
            <legend className="dash-widget-config-accordion__legend">Color by</legend>
            <div className="dash-widget-config-inline-radios">
              {(
                [
                  ["health", "Health"],
                  ["group", "Endpoint group"],
                  ["device", "Device"],
                ] as const
              ).map(([mode, label]) => (
                <label key={mode} className="dash-drawer__label dash-drawer__check">
                  <input
                    type="radio"
                    name="dash-config-map-color"
                    checked={layerControls.colorMode === mode}
                    disabled={disabled}
                    onChange={() => patchMapLayerControls({ colorMode: mode as MapLayerColorMode })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="dash-drawer__label dash-drawer__check">
            <input
              type="checkbox"
              checked={layerControls.showLabels}
              disabled={disabled}
              onChange={(e) => patchMapLayerControls({ showLabels: e.target.checked })}
            />
            Show labels on markers
          </label>
          <fieldset className="dash-widget-config-accordion__fieldset">
            <legend className="dash-widget-config-accordion__legend">Stale / offline visibility</legend>
            <div className="dash-widget-config-inline-radios">
              {(
                [
                  ["all", "All markers"],
                  ["stale", "Stale only"],
                  ["offline", "Offline only"],
                ] as const
              ).map(([mode, label]) => (
                <label key={mode} className="dash-drawer__label dash-drawer__check">
                  <input
                    type="radio"
                    name="dash-config-map-filter"
                    checked={layerControls.filterMode === mode}
                    disabled={disabled}
                    onChange={() => patchMapLayerControls({ filterMode: mode as MapLayerFilterMode })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="dash-widget__muted dash-widget-config-accordion__hint dash-widget-config-trace-hint">
            Expanded map: trace route and replay head overlays (historical / intelligence).
          </p>
          <div className="dash-widget-config-grid-trace">
            <label className="dash-drawer__label dash-drawer__check dash-widget-config-grid-trace__cell">
              <input
                type="checkbox"
                checked={layerControls.showTraceRoute}
                disabled={disabled}
                onChange={(e) => patchMapLayerControls({ showTraceRoute: e.target.checked })}
              />
              <span>Show trace route</span>
            </label>
            <label className="dash-drawer__label dash-drawer__check dash-widget-config-grid-trace__cell">
              <input
                type="checkbox"
                checked={layerControls.showReplayHead}
                disabled={disabled}
                onChange={(e) => patchMapLayerControls({ showReplayHead: e.target.checked })}
              />
              <span>Show replay head</span>
            </label>
          </div>
        </div>
      </details>
    );
  }

  function renderMapFieldsSemanticsColumn() {
    if (widget.type !== "map") return null;
    return (
      <>
        <label className="dash-drawer__label">
          KPI fields (comma-separated paths; overrides checklist on device tile)
          <input
            className="dash-drawer__input"
            value={(b.kpiFields as string[])?.join(", ") ?? ""}
            disabled={disabled}
            onChange={(e) => patchBinding({ kpiFields: parseList(e.target.value) })}
          />
        </label>
        <div className="dash-widget-config-grid-latlon">
          <FieldPathPicker
            label="Latitude field"
            value={String(b.latitudeField ?? "gps.lat")}
            onChange={(v) => patchBinding({ latitudeField: v || "gps.lat" })}
            meta={fieldMeta}
            loading={fieldMetaLoading}
            disabled={disabled}
          />
          <FieldPathPicker
            label="Longitude field"
            value={String(b.longitudeField ?? "gps.lon")}
            onChange={(v) => patchBinding({ longitudeField: v || "gps.lon" })}
            meta={fieldMeta}
            loading={fieldMetaLoading}
            disabled={disabled}
          />
        </div>
        <FieldPathPicker
          label="Title field (optional)"
          value={String(b.titleField ?? "")}
          onChange={(v) => patchBinding({ titleField: v || undefined })}
          meta={fieldMeta}
          loading={fieldMetaLoading}
          disabled={disabled}
        />
        <FieldPathPicker
          label="Health field override (optional)"
          value={String(b.healthField ?? "")}
          onChange={(v) => patchBinding({ healthField: v || undefined })}
          meta={fieldMeta}
          loading={fieldMetaLoading}
          disabled={disabled}
        />
      </>
    );
  }

  if (widget.type === "map" && mapConfigureFourColumn) {
    return (
      <div className="dash-binding dash-binding--map4">
        <div className="dash-widget-config-map4-grid">
          <div className="dash-widget-config-map4__col dash-widget-config-map4__col--basic">
            <h3 className="dash-widget-config-map4__heading">Basic</h3>
            {mapBasicSlot}
            {renderMapDataSourceAccordion()}
            {renderMapBehaviorAccordion()}
            {mapCol1Footer}
          </div>
          <div className="dash-widget-config-map4__col dash-widget-config-map4__col--fields">
            <details className="dash-widget-config-accordion" open>
              <summary className="dash-widget-config-accordion__summary">Fields &amp; semantics</summary>
              <div className="dash-widget-config-accordion__body">{renderMapFieldsSemanticsColumn()}</div>
            </details>
            <div className="dash-widget-config-map4__display-row">{renderMapDisplayAccordion()}</div>
          </div>
          <aside className="dash-widget-config-map4__col dash-widget-config-map4__col--preview" aria-label="Preview">
            {mapPreviewColumn}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-binding">
      {needsSource && widget.type !== "map" && (
        <details className="dash-widget-config-accordion" open>
          <summary className="dash-widget-config-accordion__summary">Data source</summary>
          <div className="dash-widget-config-accordion__body">
            <label className="dash-drawer__label">
              Source mode
              <select
                className="dash-drawer__input"
                value={sourceMode}
                disabled={disabled}
                onChange={(e) => {
                  const mode = e.target.value as "endpoint_group" | "individual_device";
                  if (mode === "endpoint_group") {
                    onChange({
                      ...widget,
                      binding: {
                        ...widget.binding,
                        sourceMode: "endpoint_group",
                        sourceType: "resolved_device_collection",
                        sourceId: "",
                        siteId: String(siteId ?? widget.binding.siteId ?? ""),
                      },
                    });
                    return;
                  }
                  onChange({
                    ...widget,
                    binding: {
                      ...widget.binding,
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
            <p className="dash-widget__muted dash-widget-config-accordion__hint">
              <strong>Endpoint group</strong> binds to <code>endpoints.object_name</code> for that endpoint (same string
              stored on <code>latest_device_state</code> after successful v2 resolution — it may differ from the scrubber
              pipeline title). <strong>Individual device</strong> picks one <code>latest_device_state</code> or{" "}
              <code>result_object</code>. If data is ingesting but widgets stay empty, check v2 identity publish,
              primary-device-key fields, and Kafka <code>endpoint_id</code> on scrubber envelopes.
            </p>
            {sourceMode === "endpoint_group" && (
              <EndpointGroupPickerField
                collectionOptions={collectionOptions}
                endpointId={String(widget.binding.endpointId ?? "")}
                objectName={String(widget.binding.objectName ?? "")}
                disabled={disabled || !siteId}
                below={
                  <span className="dash-widget__muted" style={{ fontSize: "0.75rem" }}>
                    Site scope: {siteId ?? "Select site first"}
                  </span>
                }
                onCommit={(endpointId, objectName) =>
                  onChange({
                    ...widget,
                    binding: {
                      ...widget.binding,
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
            {sourceMode === "individual_device" && (
              <div className="dash-endpoint-group-field-wrap">
                <IndividualDevicePickerField
                  siteId={siteId ?? null}
                  sourceType={
                    (widget.binding.sourceType as "result_object" | "latest_device_state") || "latest_device_state"
                  }
                  sourceId={String(widget.binding.sourceId ?? "")}
                  disabled={disabled || !siteId}
                  onCommit={(st, id) =>
                    onChange({
                      ...widget,
                      binding: {
                        ...widget.binding,
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
      )}

      {renderMapDataSourceAccordion()}

      {(widget.type === "health_summary" || widget.type === "alert_summary" || widget.type === "site_summary") && (
        <p className="dash-widget__muted">Uses the dashboard site for aggregation. No source binding.</p>
      )}

      <details className="dash-widget-config-accordion" open>
        <summary className="dash-widget-config-accordion__summary">Fields &amp; semantics</summary>
        <div className="dash-widget-config-accordion__body">
          {widget.type === "text" && (
            <label className="dash-drawer__label">
              Body
              <textarea
                className="dash-drawer__textarea"
                value={String(c.body ?? "")}
                disabled={disabled}
                onChange={(e) => patchConfig({ body: e.target.value })}
              />
            </label>
          )}

      {widget.type === "kpi" && (
        <FieldPathPicker
          label="Metric field"
          value={String(b.metric ?? "")}
          onChange={(v) => patchBinding({ metric: v })}
          meta={fieldMeta}
          loading={fieldMetaLoading}
          disabled={disabled}
        />
      )}

      {widget.type === "table" && (
        <>
          {fieldMeta.length > 0 ? (
            <div className="dash-drawer__label">
              <span>Columns (from payload catalog)</span>
              <div
                style={{
                  maxHeight: 160,
                  overflow: "auto",
                  border: "1px solid var(--border, #ccc)",
                  borderRadius: "var(--radius)",
                  padding: "0.4rem 0.5rem",
                  marginTop: "0.35rem",
                  fontSize: "0.82rem",
                }}
              >
                {fieldMeta.slice(0, 64).map((f) => {
                  const cur = ((b.fields as string[]) ?? []) as string[];
                  const checked = cur.includes(f.path);
                  return (
                    <label
                      key={f.path}
                      style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.2rem" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => {
                          const next = checked
                            ? cur.filter((x) => x !== f.path)
                            : [...cur, f.path];
                          patchBinding({ fields: next });
                        }}
                      />
                      <span>
                        {f.path} <span className="dash-widget__muted">({f.type})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label className="dash-drawer__label">
            Columns (comma-separated, overrides checklist; empty = all keys)
            <input
              className="dash-drawer__input"
              value={(b.fields as string[])?.join(", ") ?? ""}
              disabled={disabled}
              onChange={(e) => patchBinding({ fields: parseList(e.target.value) })}
            />
          </label>
        </>
      )}

      {(widget.type === "device_tile" || widget.type === "map") && (
        <>
          {widget.type === "device_tile" && fieldMeta.length > 0 ? (
            <div className="dash-drawer__label">
              <span>KPI fields (catalog)</span>
              <div
                style={{
                  maxHeight: 140,
                  overflow: "auto",
                  border: "1px solid var(--border, #ccc)",
                  borderRadius: "var(--radius)",
                  padding: "0.4rem 0.5rem",
                  marginTop: "0.35rem",
                  fontSize: "0.82rem",
                }}
              >
                {fieldMeta.slice(0, 48).map((f) => {
                  const cur = ((b.kpiFields as string[]) ?? []) as string[];
                  const checked = cur.includes(f.path);
                  return (
                    <label
                      key={f.path}
                      style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.2rem" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => {
                          const next = checked
                            ? cur.filter((x) => x !== f.path)
                            : [...cur, f.path];
                          patchBinding({ kpiFields: next });
                        }}
                      />
                      <span>
                        {f.path} <span className="dash-widget__muted">({f.type})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          {widget.type === "device_tile" ? (
            <label className="dash-drawer__label">
              KPI fields (comma-separated paths; overrides checklist on device tile)
              <input
                className="dash-drawer__input"
                value={(b.kpiFields as string[])?.join(", ") ?? ""}
                disabled={disabled}
                onChange={(e) => patchBinding({ kpiFields: parseList(e.target.value) })}
              />
            </label>
          ) : null}
          {widget.type === "map" ? renderMapFieldsSemanticsColumn() : null}
        </>
      )}
        </div>
      </details>

      {renderMapBehaviorAccordion()}

      {renderMapDisplayAccordion()}

    </div>
  );
}
