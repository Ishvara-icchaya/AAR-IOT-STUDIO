import type { DashboardWidgetInstance2 } from "@/types/dashboard2";

export function DashboardWidgetBindingPicker({
  widget,
  onChange,
}: {
  widget: DashboardWidgetInstance2;
  onChange: (next: DashboardWidgetInstance2) => void;
}) {
  const binding = widget.binding;
  return (
    <div className="dashboard2-config-block">
      <h4>Binding</h4>
      <label>
        Source type
        <select
          value={binding.sourceType}
          onChange={(e) => {
            const sourceType = e.target.value as DashboardWidgetInstance2["binding"]["sourceType"];
            if (sourceType === "resolved_device_collection") {
              onChange({
                ...widget,
                binding: { sourceType, siteId: "", endpointId: "", objectName: "" },
              });
            }
            if (sourceType === "individual_device") {
              onChange({
                ...widget,
                binding: { sourceType, siteId: "", resolvedDeviceId: "" },
              });
            }
            if (sourceType === "reporting_object") {
              onChange({
                ...widget,
                binding: { sourceType, siteId: "", reportingObjectId: "" },
              });
            }
          }}
        >
          <option value="resolved_device_collection">resolved_device_collection</option>
          <option value="individual_device">individual_device</option>
          <option value="reporting_object">reporting_object</option>
        </select>
      </label>
      {"siteId" in binding ? (
        <label>
          Site ID
          <input
            value={binding.siteId ?? ""}
            onChange={(e) => onChange({ ...widget, binding: { ...binding, siteId: e.target.value } as typeof binding })}
          />
        </label>
      ) : null}
      {"endpointId" in binding ? (
        <label>
          Endpoint ID
          <input
            value={binding.endpointId ?? ""}
            onChange={(e) =>
              onChange({ ...widget, binding: { ...binding, endpointId: e.target.value } as typeof binding })
            }
          />
        </label>
      ) : null}
      {"objectName" in binding ? (
        <label>
          Object name
          <input
            value={binding.objectName ?? ""}
            onChange={(e) =>
              onChange({ ...widget, binding: { ...binding, objectName: e.target.value } as typeof binding })
            }
          />
        </label>
      ) : null}
    </div>
  );
}
