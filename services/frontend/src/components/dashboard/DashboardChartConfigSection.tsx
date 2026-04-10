import { useEffect, useState } from "react";
import { getScrubberDataObject } from "@/api/scrubber";
import { getResultObject } from "@/api/resultObjects";
import { CHART_X_TIME_OPTIONS, isPresetChartXField } from "@/lib/chartAxisOptions";
import { optionsFromKpiJson, optionsFromPayloadMetrics, type KpiAxisOption } from "@/lib/chartKpiFieldOptions";
import type { DashboardWidgetModel } from "@/types/dashboardLayout";

const CHART_KINDS: { value: string; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "histogram", label: "Histogram" },
  { value: "stacked_bar", label: "Stacked bar" },
];

const TIME_WINDOWS: { value: string; label: string }[] = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All data" },
];

type Props = {
  widget: DashboardWidgetModel;
  onChange: (next: DashboardWidgetModel) => void;
  disabled?: boolean;
};

export function DashboardChartConfigSection({ widget, onChange, disabled }: Props) {
  const b = widget.binding;
  const [kpiOptions, setKpiOptions] = useState<KpiAxisOption[]>([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState<string | null>(null);

  const sourceId = String(b.sourceId ?? "").trim();
  const sourceType = (b.sourceType as string) || "data_object";

  useEffect(() => {
    if (!sourceId) {
      setKpiOptions([]);
      setKpiError(null);
      return;
    }
    let cancelled = false;
    setKpiLoading(true);
    setKpiError(null);
    void (async () => {
      try {
        let opts: KpiAxisOption[] = [];
        if (sourceType === "data_object") {
          const row = await getScrubberDataObject(sourceId);
          if (cancelled) return;
          if (row == null) {
            setKpiOptions([]);
            setKpiError("Data object not found.");
            return;
          }
          opts = optionsFromKpiJson(row.kpi_json);
        } else {
          const row = await getResultObject(sourceId);
          if (cancelled) return;
          if (row == null) {
            setKpiOptions([]);
            setKpiError("Result object not found.");
            return;
          }
          opts = optionsFromPayloadMetrics(row.payload_json);
        }
        if (cancelled) return;
        setKpiOptions(opts);
        if (opts.length === 0) {
          setKpiError(
            sourceType === "data_object"
              ? "No KPI metrics on this data object. Configure KPIs in Scrubber Studio or pick another source."
              : "No metrics block on this result object.",
          );
        }
      } catch {
        if (!cancelled) {
          setKpiOptions([]);
          setKpiError("Could not load source KPI metadata.");
        }
      } finally {
        if (!cancelled) setKpiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, sourceType]);

  function patchBinding(partial: Record<string, unknown>) {
    onChange({ ...widget, binding: { ...widget.binding, ...partial } });
  }

  const yField = String(b.yField ?? "");
  const yOptions: KpiAxisOption[] = (() => {
    if (!yField || kpiOptions.some((o) => o.value === yField)) return kpiOptions;
    return [...kpiOptions, { value: yField, label: `${yField} (saved)` }];
  })();
  const ySelectValue = yField && yOptions.some((o) => o.value === yField) ? yField : "";
  const tw = String(b.chartTimeWindow ?? "24h");

  return (
    <div className="dash-chart-config-section">
      <div className="dash-chart-config-section__grid">
        <label className="dash-drawer__label">
          Chart type
          <select
            className="dash-drawer__input"
            value={String(b.chartType ?? "line")}
            disabled={disabled}
            onChange={(e) =>
              patchBinding({
                chartType: e.target.value as
                  | "line"
                  | "bar"
                  | "area"
                  | "stacked_bar"
                  | "histogram",
              })
            }
          >
            {CHART_KINDS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dash-drawer__label">
          X axis (time)
          <select
            className="dash-drawer__input"
            disabled={disabled}
            value={isPresetChartXField(b.xField as string) ? String(b.xField ?? "t") : "__custom__"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom__") patchBinding({ xField: "" });
              else patchBinding({ xField: v });
            }}
          >
            {CHART_X_TIME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="__custom__">Custom path…</option>
          </select>
          {!isPresetChartXField(b.xField as string) && (
            <input
              className="dash-drawer__input"
              style={{ marginTop: "0.35rem" }}
              disabled={disabled}
              placeholder="Dot path for time"
              value={String(b.xField ?? "")}
              onChange={(e) => patchBinding({ xField: e.target.value })}
            />
          )}
        </label>
        <label className="dash-drawer__label">
          Y axis (KPI attribute)
          {kpiLoading ? (
            <span className="dash-widget__muted" style={{ fontSize: "0.78rem" }}>
              Loading KPIs from source…
            </span>
          ) : yOptions.length > 0 ? (
            <select
              className="dash-drawer__input"
              disabled={disabled}
              value={ySelectValue}
              onChange={(e) => patchBinding({ yField: e.target.value })}
            >
              <option value="">Select metric…</option>
              {yOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="dash-widget__muted" style={{ fontSize: "0.78rem", margin: "0.25rem 0 0" }}>
              {sourceId ? kpiError ?? "No KPI metrics found." : "Select a source first."}
            </p>
          )}
        </label>
        <label className="dash-drawer__label">
          Time range
          <select
            className="dash-drawer__input"
            disabled={disabled}
            value={tw}
            onChange={(e) => patchBinding({ chartTimeWindow: e.target.value })}
          >
            {TIME_WINDOWS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="dash-widget__muted" style={{ display: "block", marginTop: "0.3rem", fontSize: "0.72rem" }}>
            Filters points by timestamp on the X field (trends from worker / timeseries payloads).
          </span>
        </label>
      </div>
    </div>
  );
}
