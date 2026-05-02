/**
 * Preset options for v2 ingest endpoint UI — keeps POST/PATCH payloads aligned with API validation.
 */

import { INGEST_PROTOCOLS, type IngestProtocol, normalizeProtocol } from "@/lib/deviceEndpointConfig";

export { INGEST_PROTOCOLS, type IngestProtocol };

/** Protocol values sent to `POST /endpoints` (lowercase). */
export const V2_ENDPOINT_PROTOCOL_OPTIONS: { value: IngestProtocol; label: string }[] = INGEST_PROTOCOLS.map((p) => ({
  value: p,
  label:
    p === "http"
      ? "HTTP"
      : p === "mqtt"
        ? "MQTT"
        : p === "coap"
          ? "CoAP"
          : "WebSocket",
}));

/** JSON paths for primary key extraction (v2 identity). */
export const PRIMARY_KEY_PATH_OPTIONS = [
  "id",
  "device_id",
  "serial",
  "serialNumber",
  "imei",
  "mac",
  "uuid",
  "external_id",
  "asset_id",
  "unit_id",
] as const;

/** JSON paths for device label in resolved views. */
export const DEVICE_LABEL_PATH_OPTIONS = [
  "name",
  "label",
  "device_name",
  "description",
  "title",
  "friendly_name",
  "asset_name",
] as const;

/** Table / filter lifecycle values observed on `endpoints.lifecycle_status`. */
export const ENDPOINT_LIFECYCLE_FILTERS = [
  { value: "all", label: "All lifecycles" },
  { value: "draft", label: "draft" },
  { value: "needs_identity_mapping", label: "needs identity mapping" },
  { value: "active", label: "active" },
  { value: "error", label: "error" },
  { value: "disabled", label: "disabled" },
] as const;

/** Allowed characters for custom names (single segment, no commas). */
const CUSTOM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,254}$/;
export function isValidCustomEndpointName(s: string): boolean {
  return CUSTOM_NAME_RE.test(s.trim());
}

export function protocolLabelForTable(p: string): string {
  const n = normalizeProtocol(p);
  if (n === "http") return "HTTP";
  if (n === "websocket") return "WebSocket";
  if (!n) return "—";
  return n.toUpperCase();
}
