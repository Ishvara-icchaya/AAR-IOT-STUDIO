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

/** If the dotted path suggests an encoded / tabular string field (leaf-aware). */
function encodedTypeFromPath(fieldPath: string): string | null {
  const p = fieldPath.trim().toLowerCase();
  if (!p) return null;
  const leaf = p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : p;
  const hay = `${p} ${leaf}`;
  if (/\bbase64\b|_base64|base64_|(^|[^a-z])b64([^a-z]|$)|_b64\b/.test(hay)) return "base64";
  if (/\bcsv\b|_csv|csv_|csvmetrics|metrics_csv|_csv_/.test(hay)) return "csv";
  if (/_hex_|_hex$|^_hex|hexdigest|hex_bin|_as_hex|hex_encoded/.test(hay)) return "hex";
  return null;
}

function looksLikeHexBytes(s: string): boolean {
  const t = s.trim();
  if (t.length < 16 || t.length % 2 === 1) return false;
  if (!/^[0-9a-fA-F]+$/.test(t)) return false;
  // Common digest / token lengths; avoids classifying short decimal-ish tokens as hex.
  if (t.length >= 32) return true;
  return t.length >= 16 && t.length <= 64;
}

function looksLikeBase64Payload(s: string): boolean {
  const t = s.replace(/\s+/g, "");
  if (t.length < 12) return false;
  if (/^[A-Za-z0-9+/]+=*$/.test(t)) {
    const pad = (t.match(/=/g) || []).length;
    if (pad > 2) return false;
    return t.length % 4 === 0 || pad > 0;
  }
  if (/^[A-Za-z0-9_-]{16,}$/.test(t)) {
    let norm = t.replace(/-/g, "+").replace(/_/g, "/");
    while (norm.length % 4 !== 0) norm += "=";
    return /^[A-Za-z0-9+/]+=*$/.test(norm);
  }
  return false;
}

function looksLikeCsvOrKeyValueRow(s: string): boolean {
  const t = s.trim();
  if (!t.includes(",") || !t.includes("=")) return false;
  const parts = t.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((seg) => /^[^=\s]+=/.test(seg));
}

/**
 * Infer a display / semantics type for scrubber pickers (Semantics, KPI, etc.).
 * Strings that are clearly hex, base64, or CSV / key=value rows are not labeled plain `string`.
 */
export function inferFieldType(value: unknown, fieldPath = ""): string {
  const fromPath = encodedTypeFromPath(fieldPath);

  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return "timestamp";
    if (fromPath) return fromPath;
    if (looksLikeHexBytes(t)) return "hex";
    if (looksLikeBase64Payload(t)) return "base64";
    if (looksLikeCsvOrKeyValueRow(t)) return "csv";
    return "string";
  }
  if (typeof value === "object") return "object";
  return typeof value;
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
      type: inferFieldType(v, path),
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
