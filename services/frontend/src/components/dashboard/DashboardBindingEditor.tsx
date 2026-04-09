import type { DashboardWidgetModel } from "@/types/dashboardLayout";

type Props = {
  widget: DashboardWidgetModel;
  onChange: (next: DashboardWidgetModel) => void;
  disabled?: boolean;
};

export function DashboardBindingEditor({ widget, onChange, disabled }: Props) {
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
            onChange={(e) => patchBinding({ metric: e.target.value })}
          />
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

      {widget.type === "chart" && (
        <>
          <label className="dash-drawer__label">
            Chart type
            <select
              className="dash-drawer__input"
              value={String(b.chartType ?? "line")}
              disabled={disabled}
              onChange={(e) =>
                patchBinding({ chartType: e.target.value as "line" | "bar" | "area" | "stacked_bar" })
              }
            >
              <option value="line">line</option>
              <option value="bar">bar</option>
              <option value="area">area</option>
              <option value="stacked_bar">stacked bar</option>
            </select>
          </label>
          <label className="dash-drawer__label">
            X field
            <input
              className="dash-drawer__input"
              value={String(b.xField ?? "")}
              disabled={disabled}
              onChange={(e) => patchBinding({ xField: e.target.value })}
            />
          </label>
          <label className="dash-drawer__label">
            Y field
            <input
              className="dash-drawer__input"
              value={String(b.yField ?? "")}
              disabled={disabled}
              onChange={(e) => patchBinding({ yField: e.target.value })}
            />
          </label>
        </>
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
        </>
      )}
    </div>
  );
}
