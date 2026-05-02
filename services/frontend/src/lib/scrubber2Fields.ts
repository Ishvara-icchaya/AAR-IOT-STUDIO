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

/** Dotted paths removed by the engine when `keepFields` is the allow-list (same as `scrubberStudio` draft). */
export function scrubber2DropPathsFromKeep(
  samplePayload: Record<string, unknown>,
  keepFields: readonly string[],
): string[] {
  const allLeaves = collectFieldPaths(samplePayload);
  const keep = new Set(keepFields.filter(Boolean));
  if (keep.size === 0 && allLeaves.length > 0) return [...allLeaves];
  return allLeaves.filter((leaf) => {
    for (const k of keep) {
      if (leaf === k || leaf.startsWith(`${k}.`)) return false;
    }
    return true;
  });
}

export function scrubber2DeleteDottedPath(obj: Record<string, unknown>, dotted: string): void {
  const parts = dotted.split(".").filter(Boolean);
  if (!parts.length) return;
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!isObjectRecord(cur) || !(part in cur)) return;
    cur = (cur as Record<string, unknown>)[part];
  }
  const last = parts[parts.length - 1];
  if (isObjectRecord(cur) && last in cur) {
    delete (cur as Record<string, unknown>)[last];
  }
}

export function scrubber2PayloadAfterDropKeep(
  samplePayload: Record<string, unknown>,
  keepFields: readonly string[],
): Record<string, unknown> {
  const tree = structuredClone(samplePayload) as Record<string, unknown>;
  for (const d of scrubber2DropPathsFromKeep(samplePayload, keepFields)) {
    scrubber2DeleteDottedPath(tree, d);
  }
  return tree;
}

function flattenOneLevelPayload(input: Record<string, unknown>, delimiter: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const delim = delimiter || "_";
  for (const [k, v] of Object.entries(input)) {
    if (isObjectRecord(v)) {
      const inner = Object.entries(v);
      if (inner.length > 0) {
        for (const [innerK, innerV] of inner) out[`${k}${delim}${innerK}`] = innerV;
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Mirrors worker `flatten` until stable (dict equality via JSON), delimiter default `_`. */
export function scrubber2FlattenComplete(
  root: Record<string, unknown>,
  delimiter = "_",
  maxRounds = 64,
): Record<string, unknown> {
  let p: Record<string, unknown> = structuredClone(root);
  for (let i = 0; i < maxRounds; i++) {
    const nxt = flattenOneLevelPayload(p, delimiter);
    if (JSON.stringify(nxt) === JSON.stringify(p)) return nxt;
    p = nxt;
  }
  return p;
}

export function scrubber2ShapedPayloadForEarlyPickers(
  samplePayload: Record<string, unknown> | null,
  keepFields: readonly string[],
  flatten: boolean,
): Record<string, unknown> | null {
  if (!samplePayload) return null;
  const after = scrubber2PayloadAfterDropKeep(samplePayload, keepFields);
  return flatten ? scrubber2FlattenComplete(after, "_") : after;
}

/** Strip scrubber-internal keys before listing paths for Semantics / Health / KPI / Location. */
export function scrubberPreviewPayloadForFieldPickers(p: Record<string, unknown>): Record<string, unknown> {
  const out = { ...p };
  for (const k of Object.keys(out)) {
    if (k.startsWith("_scrubber")) delete out[k];
  }
  return out;
}
