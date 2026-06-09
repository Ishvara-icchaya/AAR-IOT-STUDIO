import type { DeviceRead } from "@/api/devices";
import { normalizeVersionStatus } from "@/lib/deviceVersionUi";

/** Device-level operational flag (matches `devices.is_active`). */
export function deriveDeviceStatusLabel(device: DeviceRead): "Active" | "Inactive" {
  return device.is_active !== false ? "Active" : "Inactive";
}

/**
 * Data pipeline accepts new raw + scrubbed processing when the device is active and
 * `version_status` is not an ingest-blocking state (`deprecated` / `rolled_back` per product copy in UI options).
 */
export function deriveDataPipelineLabel(device: DeviceRead): "Active" | "Inactive" {
  const deviceOn = device.is_active !== false;
  const st = normalizeVersionStatus(device.version_status);
  const ingestBlocked = st === "deprecated" || st === "rolled_back";
  return deviceOn && !ingestBlocked ? "Active" : "Inactive";
}
