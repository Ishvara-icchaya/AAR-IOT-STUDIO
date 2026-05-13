import type { CSSProperties } from "react";

import { formatStatusDisplayLabel } from "@/lib/statusDisplay";

/** Must match `app/core/endpoint_activation.py` ACTIVATION_STATUS_VALUES. */
export const ENDPOINT_ACTIVATION_STATUSES = [
  "configured",
  "waiting_for_first_payload",
  "active",
  "inactive",
  "error",
] as const;

export type EndpointActivationStatus = (typeof ENDPOINT_ACTIVATION_STATUSES)[number];

export function isEndpointActivationStatus(s: string): s is EndpointActivationStatus {
  return (ENDPOINT_ACTIVATION_STATUSES as readonly string[]).includes(s);
}

/** Human-readable label (filter UI, table). */
export function formatActivationLabel(status: string): string {
  return formatStatusDisplayLabel(status);
}

/** Consistent emphasis for known statuses; unknown values stay muted. */
export function activationStatusStyle(status: string): CSSProperties {
  if (!isEndpointActivationStatus(status)) {
    return { color: "var(--color-text-muted)", fontWeight: 500 };
  }
  switch (status) {
    case "active":
      return { color: "var(--color-success, #2e7d32)", fontWeight: 600 };
    case "waiting_for_first_payload":
      return { color: "var(--color-warning, #b8860b)", fontWeight: 600 };
    case "configured":
      return { color: "var(--color-text-muted)", fontWeight: 500 };
    case "inactive":
      return { color: "var(--color-text-muted)", fontWeight: 500, fontStyle: "italic" };
    case "error":
      return { color: "var(--page-status-error-fg, #c62828)", fontWeight: 600 };
    default:
      return { color: "var(--color-text-muted)" };
  }
}
