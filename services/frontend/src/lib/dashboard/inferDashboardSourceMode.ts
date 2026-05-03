import type { DashboardWidgetBinding } from "@/types/dashboardLayout";

/** Matches persisted bindings that omit `sourceMode` (infer from `sourceType` and ids). */
export function inferDashboardSourceMode(b: DashboardWidgetBinding): "endpoint_group" | "individual_device" {
  if (b.sourceMode === "endpoint_group" || b.sourceMode === "individual_device") return b.sourceMode;
  const st = b.sourceType;
  if (st === "resolved_device_collection") return "endpoint_group";
  if (st === "latest_device_state" || st === "result_object" || st === "resolved_device_stream")
    return "individual_device";
  if (b.endpointId && b.objectName && !b.sourceId) return "endpoint_group";
  if (b.sourceId) return "individual_device";
  return "endpoint_group";
}
