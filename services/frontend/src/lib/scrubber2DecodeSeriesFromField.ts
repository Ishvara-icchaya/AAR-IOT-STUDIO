/**
 * Helpers to suggest decode_series steps from Scrubber2 Semantics / field discovery.
 * Actual decoding is always `decode_series` in scrubberStudio.draft — never implied by the Type column alone.
 */

import { getByPath, inferFieldType } from "@/lib/scrubber2Fields";

export type DecodeSeriesEngineMode = "base64_binary" | "hex_binary" | "csv_numbers" | "array" | "scalar";

export const DECODE_SERIES_AGG_DEFAULT = ["avg", "min", "max", "latest", "count"] as const;

/** Map discovery labels (Type column / inferFieldType) to engine mode. */
export function discoveryTypeToDecodeMode(dt: string): DecodeSeriesEngineMode | null {
  const d = (dt || "").toLowerCase().trim();
  if (d === "base64") return "base64_binary";
  if (d === "hex") return "hex_binary";
  if (d === "csv") return "csv_numbers";
  if (d === "array") return "array";
  return null;
}

export function defaultDataTypeForMode(mode: DecodeSeriesEngineMode): string {
  if (mode === "base64_binary" || mode === "hex_binary") return "int32";
  return "float";
}

export function targetPathForDecodedSource(sourcePath: string): string {
  const leaf = sourcePath.includes(".") ? sourcePath.slice(sourcePath.lastIndexOf(".") + 1) : sourcePath;
  const safe = leaf.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "field";
  return `$.decoded.${safe}`;
}

export function humanDecodeHint(mode: DecodeSeriesEngineMode): string {
  switch (mode) {
    case "base64_binary":
      return "Base64-like payload → unpack typed binary → numeric series";
    case "hex_binary":
      return "Hex-encoded bytes → unpack typed binary → numeric series";
    case "csv_numbers":
      return "Comma-separated numeric tokens → series";
    case "array":
      return "JSON array of numbers → series";
    case "scalar":
      return "Single scalar → one-sample series";
    default:
      return "Decode series";
  }
}

export type DecodeSeriesSuggestion = {
  mode: DecodeSeriesEngineMode;
  dataType: string;
  /** Short label for UX ("Base64-like", "JSON array", …). */
  detected: string;
};

/**
 * When to show **Configure decode series** for a Semantics row.
 * Uses sample payload (preview or shaped) + declared type; never auto-runs decode.
 */
export function suggestDecodeSeriesForField(
  path: string,
  declaredType: string,
  sampleRoot: Record<string, unknown> | null,
): DecodeSeriesSuggestion | null {
  if (!path.trim()) return null;
  const raw = sampleRoot ? getByPath(sampleRoot, path) : undefined;
  const inferred = raw !== undefined ? inferFieldType(raw, path) : (declaredType || "string");
  const fromDiscovery = discoveryTypeToDecodeMode(inferred) ?? discoveryTypeToDecodeMode(declaredType);
  if (fromDiscovery) {
    return {
      mode: fromDiscovery,
      dataType: defaultDataTypeForMode(fromDiscovery),
      detected:
        fromDiscovery === "base64_binary"
          ? "Base64-like (discovery)"
          : fromDiscovery === "hex_binary"
            ? "Hex-like (discovery)"
            : fromDiscovery === "csv_numbers"
              ? "CSV / key=value metrics (discovery)"
              : inferred === "array"
                ? "JSON array"
                : "Scalar / numeric",
    };
  }
  if (Array.isArray(raw)) {
    return { mode: "array", dataType: "float", detected: "JSON array" };
  }
  return null;
}

export function buildDecodeSeriesStepRecord(args: {
  sourcePath: string;
  targetPath: string;
  mode: DecodeSeriesEngineMode;
  dataType: string;
  byteOrder: "little" | "big";
  scale: number;
  offset: number;
  unit: string;
  storeSamples: boolean;
  maxSamplesToStore: number;
  aggregations: string[];
}): Record<string, unknown> {
  const step: Record<string, unknown> = {
    step_type: "decode_series",
    source_path: args.sourcePath.trim(),
    target_path: args.targetPath.trim(),
    mode: args.mode,
    data_type: args.dataType.trim().toLowerCase(),
    scale: args.scale,
    offset: args.offset,
    unit: args.unit.trim() || undefined,
    sample_rate_hz: null,
    store_samples: args.storeSamples,
    max_samples_to_store: Math.max(0, Math.trunc(args.maxSamplesToStore)),
    aggregations: args.aggregations.map((a) => a.toLowerCase().trim()).filter(Boolean),
  };
  if (args.mode === "base64_binary" || args.mode === "hex_binary") {
    step.byte_order = args.byteOrder;
  }
  return step;
}
