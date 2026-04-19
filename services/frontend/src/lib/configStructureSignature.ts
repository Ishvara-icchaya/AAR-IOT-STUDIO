/**
 * Structural fingerprint of a JSON-like config: keys at each object level and
 * array element shapes (recursive). Primitive values are ignored so only layout
 * (adding/removing/reordering object keys or changing array topology) changes the signature.
 */
export function configStructureSignature(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.map((item) => configStructureSignature(item)).join(";")}]`;
  }
  const t = typeof value;
  if (t !== "object") return ".";
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${k}:${configStructureSignature(o[k])}`).join(",")}}`;
}

/** Drop undefined (and non-JSON) noise so two configs compare consistently. */
export function jsonCloneForShape(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? {}));
}

/**
 * DB/API configs may include `null` or `""` where the form omits keys; those differ in
 * {@link configStructureSignature} and JSON equality. Normalize before comparing.
 */
export function normalizeConfigJsonForCompare(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value === "") return undefined;
  if (Array.isArray(value)) {
    const next = value.map(normalizeConfigJsonForCompare).filter((v) => v !== undefined);
    return next;
  }
  if (typeof value !== "object") return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    const v = normalizeConfigJsonForCompare(o[k]);
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[k] = sortKeysDeep(o[k]);
  }
  return out;
}

/** Stable JSON for dirty-checking configs (key order independent). */
export function stableStringifyConfig(value: unknown): string {
  return JSON.stringify(sortKeysDeep(normalizeConfigJsonForCompare(jsonCloneForShape(value))));
}
