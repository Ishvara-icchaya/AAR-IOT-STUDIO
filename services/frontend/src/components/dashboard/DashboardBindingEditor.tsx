import { useEffect, useState } from "react";
import {
  getLatestDeviceStateFieldMetadata,
  getResultObjectFieldMetadata,
  type PayloadFieldEntry,
} from "@/api/fieldMetadata";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import * as dashApi from "@/api/dashboard";
import { listDevices, type DeviceRead } from "@/api/devices";
import { listEndpoints, type EndpointRead } from "@/api/endpoints";

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
};

export function DashboardBindingEditor({ widget, onChange, disabled, siteId }: Props) {
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
  const mapTrackMode = String(c.mapTrackMode ?? "site").trim() || "site";

  const [eligibleMap, setEligibleMap] = useState<dashApi.MapEligibleItem[]>([]);
  const [mapSiteDevices, setMapSiteDevices] = useState<DeviceRead[]>([]);
  const [mapSiteEndpoints, setMapSiteEndpoints] = useState<EndpointRead[]>([]);
  const sourceIdBind = String(b.sourceId ?? "").trim();
  const sourceTypeBind = (b.sourceType as string) || "latest_device_state";
  const [fieldMeta, setFieldMeta] = useState<PayloadFieldEntry[]>([]);
  const [fieldMetaLoading, setFieldMetaLoading] = useState(false);

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

  return (
    <div className="dash-binding">
      <label className="dash-drawer__label">
        Title
        <input
          className="dash-drawer__input"
          value={widget.title}
          disabled={disabled}
          onChange={(e) => onChange({ ...widget, title: e.target.value })}
        />
      </label>

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

      {(widget.type === "health_summary" || widget.type === "alert_summary" || widget.type === "site_summary") && (
        <p className="dash-widget__muted">Uses the dashboard site for aggregation. No source binding.</p>
      )}

      {needsSource && (
        <>
          {widget.type === "map" && (
            <label className="dash-drawer__label dash-drawer__check">
              <input
                type="checkbox"
                checked={c.autoIncludeGpsObjects !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ autoIncludeGpsObjects: e.target.checked })}
              />
              Auto-include all GPS-capable objects for this site
            </label>
          )}

          {widget.type === "map" && c.autoIncludeGpsObjects !== false && (
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

          {widget.type === "map" && mapAuto && siteId && mapTrackMode !== "endpoint_groups" && (
            <div className="dash-drawer__label">
              <span className="dash-widget__muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                Devices on map — leave all unchecked to include every device at this site; check specific devices to
                limit markers
              </span>
              <div
                style={{
                  maxHeight: 200,
                  overflow: "auto",
                  border: "1px solid var(--border, #ccc)",
                  borderRadius: "var(--radius)",
                  padding: "0.5rem",
                  fontSize: "0.85rem",
                }}
              >
                {mapSiteDevices.length === 0 ? (
                  <span className="dash-widget__muted">No devices or loading…</span>
                ) : (
                  mapSiteDevices.map((d) => {
                    const allowed = (c.mapDeviceIds as string[] | undefined) ?? [];
                    const allIds = mapSiteDevices.map((x) => x.id);
                    const restrict = allowed.length > 0;
                    const checked = !restrict || allowed.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.25rem" }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => {
                            const cur = (c.mapDeviceIds as string[] | undefined) ?? [];
                            if (!restrict) {
                              const next = allIds.filter((id) => id !== d.id);
                              patchConfig({ mapDeviceIds: next });
                              return;
                            }
                            if (cur.includes(d.id)) {
                              const next = cur.filter((id) => id !== d.id);
                              patchConfig({ mapDeviceIds: next });
                            } else {
                              const next = [...cur, d.id];
                              const setNext = new Set(next);
                              if (allIds.length > 0 && allIds.every((id) => setNext.has(id))) {
                                patchConfig({ mapDeviceIds: [] });
                              } else {
                                patchConfig({ mapDeviceIds: next });
                              }
                            }
                          }}
                        />
                        <span>
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

          {widget.type === "map" && !mapAuto && siteId && mapTrackMode !== "endpoint_groups" && (
            <div className="dash-drawer__label">
              <span className="dash-widget__muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                Map objects (eligible for this site — multiselect)
              </span>
              <div
                style={{
                  maxHeight: 200,
                  overflow: "auto",
                  border: "1px solid var(--border, #ccc)",
                  borderRadius: "var(--radius)",
                  padding: "0.5rem",
                  fontSize: "0.85rem",
                }}
              >
                {eligibleMap.length === 0 ? (
                  <span className="dash-widget__muted">No eligible objects or loading…</span>
                ) : (
                  eligibleMap.map((item) => {
                    const checked = (
                      (c.includedSources as Array<{ sourceType: string; sourceId: string }>) ?? []
                    ).some((x) => x.sourceType === item.source_type && x.sourceId === item.source_id);
                    return (
                      <label
                        key={`${item.source_type}:${item.source_id}`}
                        style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.25rem" }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleIncluded(item)}
                        />
                        <span>
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
        </>
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
          <label className="dash-drawer__label">
            KPI fields (comma-separated paths; overrides checklist on device tile)
            <input
              className="dash-drawer__input"
              value={(b.kpiFields as string[])?.join(", ") ?? ""}
              disabled={disabled}
              onChange={(e) => patchBinding({ kpiFields: parseList(e.target.value) })}
            />
          </label>
        </>
      )}

      {widget.type === "map" && (
        <>
          {siteId ? (
            <label className="dash-drawer__label">
              Map tracks
              <select
                className="dash-drawer__input"
                disabled={disabled}
                value={mapTrackMode}
                onChange={(e) => {
                  const v = e.target.value;
                  patchConfig({ mapTrackMode: v });
                  if (v === "endpoint_groups") {
                    patchConfig({
                      autoIncludeGpsObjects: false,
                      mapEndpointGroupEntries:
                        Array.isArray(c.mapEndpointGroupEntries) && (c.mapEndpointGroupEntries as unknown[]).length
                          ? c.mapEndpointGroupEntries
                          : [{ endpointId: "", objectName: "" }],
                    });
                  } else if (v === "site") {
                    patchConfig({ mapEndpointGroupEntries: [], autoIncludeGpsObjects: true });
                  } else {
                    patchConfig({ mapEndpointGroupEntries: [], autoIncludeGpsObjects: true });
                  }
                }}
              >
                <option value="site">Site — all GPS data objects (auto)</option>
                <option value="devices">Selected devices (filter)</option>
                <option value="endpoint_groups">Endpoint group(s) — fleet / LDS positions</option>
              </select>
              <span className="dash-widget__muted" style={{ display: "block", marginTop: "0.25rem", fontSize: "0.78rem" }}>
                Endpoint groups use live resolved-device positions; each group gets a distinct marker color. Devices
                mode filters site auto-map to checked devices only.
              </span>
            </label>
          ) : null}
          {mapTrackMode === "endpoint_groups" && siteId ? (
            <div className="dash-drawer__label">
              <span className="dash-widget__muted" style={{ display: "block", marginBottom: "0.35rem" }}>
                Endpoint groups (one or more)
              </span>
              {(Array.isArray(c.mapEndpointGroupEntries) ? (c.mapEndpointGroupEntries as Record<string, unknown>[]) : []).map(
                (row, idx) => {
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
                            patchConfig({ mapEndpointGroupEntries: rows });
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
                            patchConfig({ mapEndpointGroupEntries: rows });
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
                          patchConfig({ mapEndpointGroupEntries: rows.length ? rows : [{ endpointId: "", objectName: "" }] });
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                },
              )}
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
                  patchConfig({ mapEndpointGroupEntries: [...rows, { endpointId: "", objectName: "" }] });
                }}
              >
                + Add group
              </button>
            </div>
          ) : null}
          <label className="dash-drawer__label dash-drawer__check">
            <input
              type="checkbox"
              checked={c.mapAggregateByDevice === true}
              disabled={disabled}
              onChange={(e) => patchConfig({ mapAggregateByDevice: e.target.checked })}
            />
            One marker per device (centroid when multiple GPS feeds per device)
          </label>
          <label className="dash-drawer__label dash-drawer__check">
            <input
              type="checkbox"
              checked={c.mapSmoothMarkers !== false}
              disabled={disabled}
              onChange={(e) => patchConfig({ mapSmoothMarkers: e.target.checked })}
            />
            Smooth marker motion on refresh (realtime)
          </label>
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

          <fieldset
            style={{ border: "1px solid var(--border, #ccc)", borderRadius: "var(--radius)", padding: "0.5rem 0.75rem", marginTop: "0.5rem" }}
          >
            <legend className="dash-widget__muted" style={{ fontSize: "0.85rem", padding: "0 0.25rem" }}>
              Map behavior (live view)
            </legend>
            <label className="dash-drawer__label dash-drawer__check" style={{ marginBottom: "0.35rem" }}>
              <input
                type="checkbox"
                checked={c.autoFitOnFirstLoad !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ autoFitOnFirstLoad: e.target.checked })}
              />
              Auto-fit to markers on first load
            </label>
            <label className="dash-drawer__label dash-drawer__check" style={{ marginBottom: "0.35rem" }}>
              <input
                type="checkbox"
                checked={c.autoFitOnRefresh === true}
                disabled={disabled}
                onChange={(e) => patchConfig({ autoFitOnRefresh: e.target.checked })}
              />
              Auto-fit on every refresh (overrides preserve viewport)
            </label>
            <label className="dash-drawer__label dash-drawer__check" style={{ marginBottom: "0.35rem" }}>
              <input
                type="checkbox"
                checked={c.preserveViewport !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ preserveViewport: e.target.checked })}
              />
              Preserve center / zoom between refreshes (when auto-fit on refresh is off)
            </label>
            <label className="dash-drawer__label dash-drawer__check" style={{ marginBottom: "0.35rem" }}>
              <input
                type="checkbox"
                checked={c.clusterMarkers !== false}
                disabled={disabled}
                onChange={(e) => patchConfig({ clusterMarkers: e.target.checked })}
              />
              Cluster markers (GeoJSON layers; always on if count exceeds max direct)
            </label>
            <label className="dash-drawer__label">
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
          </fieldset>
        </>
      )}
    </div>
  );
}
