import { useEffect, useState } from "react";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";
import * as dashApi from "@/api/dashboard";

type Props = {
  widget: DashboardWidgetModel;
  onChange: (next: DashboardWidgetModel) => void;
  disabled?: boolean;
  /** Dashboard site — required for map eligible multiselect when auto GPS is off. */
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

  const [eligibleMap, setEligibleMap] = useState<dashApi.MapEligibleItem[]>([]);
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

          {widget.type === "map" && !mapAuto && siteId && (
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
        <label className="dash-drawer__label">
          Metric field (path or key)
          <input
            className="dash-drawer__input"
            value={String(b.metric ?? "")}
            disabled={disabled}
            placeholder='value — or e.g. temperature, metrics.temp.value'
            onChange={(e) => patchBinding({ metric: e.target.value })}
          />
          <span className="dash-widget__muted" style={{ display: "block", marginTop: "0.35rem", fontSize: "0.8rem" }}>
            Default <code>value</code> matches a top-level key, then scrubber KPI <code>metrics</code> /{" "}
            <code>displayFields</code>, then a single numeric field on the payload.
          </span>
        </label>
      )}

      {widget.type === "table" && (
        <label className="dash-drawer__label">
          Columns (comma-separated field names, empty = all keys)
          <input
            className="dash-drawer__input"
            value={(b.fields as string[])?.join(", ") ?? ""}
            disabled={disabled}
            onChange={(e) => patchBinding({ fields: parseList(e.target.value) })}
          />
        </label>
      )}

      {(widget.type === "device_tile" || widget.type === "map") && (
        <label className="dash-drawer__label">
          KPI fields (comma-separated paths)
          <input
            className="dash-drawer__input"
            value={(b.kpiFields as string[])?.join(", ") ?? ""}
            disabled={disabled}
            onChange={(e) => patchBinding({ kpiFields: parseList(e.target.value) })}
          />
        </label>
      )}

      {widget.type === "map" && (
        <>
          <label className="dash-drawer__label">
            Latitude field
            <input
              className="dash-drawer__input"
              value={String(b.latitudeField ?? "gps.lat")}
              disabled={disabled}
              onChange={(e) => patchBinding({ latitudeField: e.target.value })}
            />
          </label>
          <label className="dash-drawer__label">
            Longitude field
            <input
              className="dash-drawer__input"
              value={String(b.longitudeField ?? "gps.lon")}
              disabled={disabled}
              onChange={(e) => patchBinding({ longitudeField: e.target.value })}
            />
          </label>
          <label className="dash-drawer__label">
            Title field (optional, from payload)
            <input
              className="dash-drawer__input"
              value={String(b.titleField ?? "")}
              disabled={disabled}
              onChange={(e) => patchBinding({ titleField: e.target.value || undefined })}
            />
          </label>
          <label className="dash-drawer__label">
            Health field override (optional path)
            <input
              className="dash-drawer__input"
              value={String(b.healthField ?? "")}
              disabled={disabled}
              onChange={(e) => patchBinding({ healthField: e.target.value || undefined })}
            />
          </label>

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
