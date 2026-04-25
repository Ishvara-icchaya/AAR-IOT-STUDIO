/** Field metadata extraction for Scrubber 2.0 (no manual dotted-path typing in primary flows). */

export type Scrubber2FieldMeta = {
  path: string;
  type: string;
  sample: string;
  source: "payload";
  label?: string;
  description?: string;
};

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function inferType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return "timestamp";
    return "string";
  }
  if (typeof v === "object") return "object";
  return typeof v;
}

function sampleString(v: unknown, max = 120): string {
  try {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v;
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(v);
  }
}

/** Leaf and shallow object/array paths (depth-capped), aligned with legacy studio path listing. */
export function collectFieldPaths(value: unknown, parent = "", depth = 0): string[] {
  if (depth > 8) return [];
  if (isObjectRecord(value)) {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      const p = parent ? `${parent}.${k}` : k;
      if (isObjectRecord(v)) out.push(...collectFieldPaths(v, p, depth + 1));
      else if (Array.isArray(v)) out.push(p);
      else out.push(p);
    }
    return out;
  }
  return parent ? [parent] : [];
}

export function buildFieldMetaList(root: Record<string, unknown>): Scrubber2FieldMeta[] {
  const paths = collectFieldPaths(root);
  const uniq = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
  return uniq.map((path) => {
    const v = getByPath(root, path);
    return {
      path,
      type: inferType(v),
      sample: sampleString(v),
      source: "payload",
    };
  });
}

export function getByPath(obj: unknown, dotted: string): unknown {
  if (!dotted.trim()) return obj;
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (!part) continue;
    if (!isObjectRecord(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}
