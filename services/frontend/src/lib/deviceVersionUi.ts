import { formatStatusDisplayLabel } from "@/lib/statusDisplay";

/** Normalize API / CSV values for channel + version status pills on Manage Devices. */

export type FirmwareChannel = "stable" | "beta" | "dev" | "custom" | (string & {});

export type VersionStatus =
  | "active"
  | "detected"
  | "draft"
  | "deprecated"
  | "isolated"
  | "candidate"
  | "pending"
  | "breaking"
  | "rolled_back"
  | (string & {});

export function normalizeFirmwareChannel(raw: string | null | undefined): FirmwareChannel {
  const v = (raw || "stable").trim().toLowerCase();
  if (v === "stable" || v === "beta" || v === "dev" || v === "custom") return v;
  return "stable";
}

export function normalizeVersionStatus(raw: string | null | undefined): VersionStatus {
  const v = (raw || "active").trim().toLowerCase().replace(/\s+/g, "_");
  if (
    v === "active" ||
    v === "detected" ||
    v === "draft" ||
    v === "deprecated" ||
    v === "isolated" ||
    v === "candidate" ||
    v === "pending" ||
    v === "breaking" ||
    v === "rolled_back"
  )
    return v;
  return "active";
}

/** ``devices.version_status`` presets; ``deprecated`` / ``rolled_back`` block raw ingest + scrubber. */
export const DEVICE_VERSION_STATUS_UI_OPTIONS: { value: VersionStatus; label: string }[] = [
  { value: "active", label: "Active — accept ingest" },
  { value: "deprecated", label: "Deprecated — block raw ingest & scrubber" },
  { value: "rolled_back", label: "Rolled back — block raw ingest & scrubber" },
  { value: "draft", label: "Draft" },
  { value: "detected", label: "Detected" },
  { value: "isolated", label: "Isolated" },
  { value: "candidate", label: "Candidate" },
  { value: "pending", label: "Pending" },
  { value: "breaking", label: "Breaking" },
];

/** CSS module / BEM suffix for `dm-version-pill--${suffix}` */
export function firmwareChannelPillSuffix(ch: FirmwareChannel): string {
  if (ch === "stable") return "stable";
  if (ch === "beta") return "beta";
  if (ch === "dev") return "dev";
  if (ch === "custom") return "custom";
  return "unknown";
}

export function versionStatusPillSuffix(st: VersionStatus): string {
  if (st === "active") return "active";
  if (st === "detected" || st === "draft") return "pending";
  if (st === "deprecated") return "rolled_back";
  if (st === "isolated") return "breaking";
  if (st === "candidate" || st === "pending") return "pending";
  if (st === "breaking") return "breaking";
  if (st === "rolled_back") return "rolled_back";
  return "unknown";
}

export function formatFirmwareChannelLabel(ch: FirmwareChannel): string {
  return formatStatusDisplayLabel(String(ch));
}

export function formatVersionStatusLabel(st: VersionStatus): string {
  return formatStatusDisplayLabel(String(st));
}
