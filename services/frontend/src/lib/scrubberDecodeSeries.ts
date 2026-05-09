/**
 * Browser mirror of `decode_series` scrubber step (see docs/SCRUBBER_DECODE_SERIES_SPEC.md).
 * Keeps Scrubber Studio live output aligned with API/worker for the same config.
 */

const V1_MODES = new Set(["scalar", "array", "base64_binary", "csv_numbers", "hex_binary"]);
const BINARY_DT = new Set(["int16", "int32", "float32"]);
const ARRAY_SCALAR_DT = new Set(["float", "int", "int16", "int32", "float32"]);

function normalizePath(path: string): string {
  const p = path.trim();
  if (p.startsWith("$.")) return p.slice(2);
  if (p.startsWith("$")) return p.replace(/^\$\.?/, "");
  return p;
}

function getDotted(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of normalizePath(dotted).split(".")) {
    if (!part) continue;
    if (!isObjectRecord(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setDotted(root: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = normalizePath(dotted)
    .split(".")
    .filter(Boolean);
  if (parts.length === 0) return;
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isObjectRecord(cur)) return;
    let nxt = cur[p];
    if (!isObjectRecord(nxt)) {
      nxt = {};
      cur[p] = nxt;
    }
    cur = nxt;
  }
  if (isObjectRecord(cur)) cur[parts[parts.length - 1]] = value as unknown;
}

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIntegerDtype(dt: string): boolean {
  return dt === "int" || dt === "int16" || dt === "int32";
}

function parseScalarToken(raw: unknown, dataType: string): number {
  const dt = (dataType || "float").toLowerCase().trim();
  if (typeof raw === "boolean") throw new Error("NON_NUMERIC_VALUE");
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (isIntegerDtype(dt)) return Math.trunc(raw);
    return raw;
  }
  if (raw == null) throw new Error("NON_NUMERIC_VALUE");
  const s = String(raw).trim();
  if (!s) throw new Error("NON_NUMERIC_VALUE");
  if (isIntegerDtype(dt)) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error("NON_NUMERIC_VALUE");
    return Math.trunc(n);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("NON_NUMERIC_VALUE");
  return n;
}

function unpackBinary(data: Uint8Array, dataType: string, byteOrder: string): number[] {
  const le = byteOrder === "little";
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: number[] = [];
  if (dataType === "int16") {
    if (data.length % 2 !== 0) throw new Error("BINARY_LENGTH_MISMATCH");
    for (let i = 0; i < data.length; i += 2) out.push(view.getInt16(i, le));
  } else if (dataType === "int32") {
    if (data.length % 4 !== 0) throw new Error("BINARY_LENGTH_MISMATCH");
    for (let i = 0; i < data.length; i += 4) out.push(view.getInt32(i, le));
  } else if (dataType === "float32") {
    if (data.length % 4 !== 0) throw new Error("BINARY_LENGTH_MISMATCH");
    for (let i = 0; i < data.length; i += 4) out.push(view.getFloat32(i, le));
  } else throw new Error("UNSUPPORTED_DATA_TYPE");
  return out;
}

function errorBlob(sourcePath: string, errorCode: string, message: string): Record<string, unknown> {
  return { step_type: "decode_series", source_path: sourcePath, error_code: errorCode, message };
}

const MSG: Record<string, string> = {
  SOURCE_PATH_MISSING: "Source path did not resolve to a value.",
  TARGET_PATH_MISSING: "target_path is required.",
  UNSUPPORTED_MODE: "Unsupported decode_series mode.",
  UNSUPPORTED_DATA_TYPE: "Unsupported data_type for this mode.",
  INVALID_BASE64: "Unable to decode base64 series field.",
  INVALID_HEX: "Unable to decode hex series field.",
  INVALID_CSV_TOKEN: "Invalid CSV number token.",
  BINARY_LENGTH_MISMATCH: "Binary length does not match data_type width.",
  MAX_SAMPLES_EXCEEDED: "Decoded series exceeds configured or security limits.",
  NON_NUMERIC_VALUE: "Value could not be parsed as a number.",
};

const MAX_DEC = 1048576;
const MAX_SAMPLES = 10000;
const MAX_CSV = 262144;
const MAX_HEX = 262144;

function pick(step: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in step) return step[k];
  }
  return undefined;
}

function decodeOneStep(step: Record<string, unknown>, payload: Record<string, unknown>): Record<string, unknown> {
  const sourcePath = String(pick(step, "source_path", "sourcePath") ?? "").trim();
  const targetPath = String(pick(step, "target_path", "targetPath") ?? "").trim();
  if (!sourcePath) throw new Error("SOURCE_PATH_MISSING");
  if (!targetPath) throw new Error("TARGET_PATH_MISSING");

  const mode = String(pick(step, "mode") ?? "").trim();
  if (!V1_MODES.has(mode)) throw new Error("UNSUPPORTED_MODE");

  const dataType = String(pick(step, "data_type", "dataType") ?? "").toLowerCase().trim();
  let byteOrder = String(pick(step, "byte_order", "byteOrder") ?? "little").toLowerCase().trim();
  if (mode === "base64_binary" || mode === "hex_binary") {
    if (!BINARY_DT.has(dataType)) throw new Error("UNSUPPORTED_DATA_TYPE");
    if (byteOrder !== "little" && byteOrder !== "big") throw new Error("UNSUPPORTED_DATA_TYPE");
  } else {
    if (!ARRAY_SCALAR_DT.has(dataType)) throw new Error("UNSUPPORTED_DATA_TYPE");
  }

  const sc = pick(step, "scale");
  const off = pick(step, "offset");
  const scale = typeof sc === "number" ? sc : 1;
  const offset = typeof off === "number" ? off : 0;
  if (!Number.isFinite(scale) || !Number.isFinite(offset)) throw new Error("NON_NUMERIC_VALUE");

  const unit = pick(step, "unit");
  const sampleRateHz = pick(step, "sample_rate_hz", "sampleRateHz");
  const ss = pick(step, "store_samples", "storeSamples");
  const storeSamples = ss === undefined ? true : Boolean(ss);
  const mst = pick(step, "max_samples_to_store", "maxSamplesToStore");
  const maxSamplesToStore =
    typeof mst === "number" && Number.isFinite(mst) ? Math.max(0, Math.trunc(mst)) : 1000;

  const aggsIn = pick(step, "aggregations");
  const aggsList = Array.isArray(aggsIn) ? aggsIn : null;
  const want = new Set<string>(
    aggsList && aggsList.length
      ? aggsList.filter((x): x is string => typeof x === "string").map((a) => a.toLowerCase().trim())
      : ["latest", "count"],
  );

  let series: number[] = [];

  if (mode === "scalar") {
    const rawVal = getDotted(payload, sourcePath);
    if (rawVal === undefined || rawVal === null) throw new Error("SOURCE_PATH_MISSING");
    series = [parseScalarToken(rawVal, dataType)];
  } else if (mode === "array") {
    const rawVal = getDotted(payload, sourcePath);
    if (rawVal === undefined || rawVal === null) throw new Error("SOURCE_PATH_MISSING");
    if (!Array.isArray(rawVal)) throw new Error("NON_NUMERIC_VALUE");
    series = rawVal.map((x) => parseScalarToken(x, dataType));
  } else if (mode === "csv_numbers") {
    const rawVal = getDotted(payload, sourcePath);
    if (rawVal === undefined || rawVal === null) throw new Error("SOURCE_PATH_MISSING");
    const s = typeof rawVal === "string" ? rawVal : String(rawVal);
    if (s.length > MAX_CSV) throw new Error("MAX_SAMPLES_EXCEEDED");
    if (s.trim() === "") series = [];
    else {
      series = [];
      for (const tok of s.split(",")) {
        const t = tok.trim();
        if (t === "") continue;
        series.push(parseScalarToken(t, dataType));
      }
    }
  } else if (mode === "base64_binary") {
    const rawVal = getDotted(payload, sourcePath);
    if (rawVal === undefined || rawVal === null) throw new Error("SOURCE_PATH_MISSING");
    if (typeof rawVal !== "string") throw new Error("INVALID_BASE64");
    const enc = String(pick(step, "encoding") ?? "base64").toLowerCase().trim();
    if (enc !== "base64") throw new Error("UNSUPPORTED_MODE");
    let bin: string;
    try {
      bin = atob(rawVal);
    } catch {
      throw new Error("INVALID_BASE64");
    }
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    if (data.length > MAX_DEC) throw new Error("MAX_SAMPLES_EXCEEDED");
    series = unpackBinary(data, dataType, byteOrder);
  } else if (mode === "hex_binary") {
    const rawVal = getDotted(payload, sourcePath);
    if (rawVal === undefined || rawVal === null) throw new Error("SOURCE_PATH_MISSING");
    const hs0 = typeof rawVal === "string" ? rawVal : String(rawVal);
    const hs = hs0.replace(/\s+/g, "");
    if (hs.length > MAX_HEX) throw new Error("MAX_SAMPLES_EXCEEDED");
    if (hs.length % 2 !== 0) throw new Error("INVALID_HEX");
    const data = new Uint8Array(hs.length / 2);
    for (let i = 0; i < hs.length; i += 2) {
      const b = Number.parseInt(hs.slice(i, i + 2), 16);
      if (!Number.isFinite(b)) throw new Error("INVALID_HEX");
      data[i / 2] = b;
    }
    if (data.length > MAX_DEC) throw new Error("MAX_SAMPLES_EXCEEDED");
    series = unpackBinary(data, dataType, byteOrder);
  } else throw new Error("UNSUPPORTED_MODE");

  if (series.length > MAX_SAMPLES) throw new Error("MAX_SAMPLES_EXCEEDED");

  const scaled: number[] = [];
  for (const v of series) {
    const x = v * scale + offset;
    if (!Number.isFinite(x)) throw new Error("NON_NUMERIC_VALUE");
    if ((mode === "base64_binary" || mode === "hex_binary") && (dataType === "int16" || dataType === "int32")) {
      scaled.push(Math.trunc(x));
    } else if ((mode === "scalar" || mode === "array" || mode === "csv_numbers") && isIntegerDtype(dataType)) {
      scaled.push(Math.trunc(x));
    } else scaled.push(x);
  }

  const n = scaled.length;
  const aggregations: Record<string, unknown> = {};
  if (want.has("count")) aggregations.count = n;
  if (n > 0) {
    const nums = scaled.map((x) => x);
    if (want.has("min")) aggregations.min = Math.min(...nums);
    if (want.has("max")) aggregations.max = Math.max(...nums);
    if (want.has("avg")) aggregations.avg = nums.reduce((a, b) => a + b, 0) / n;
    if (want.has("latest")) aggregations.latest = scaled[n - 1];
  } else {
    if (want.has("min")) aggregations.min = null;
    if (want.has("max")) aggregations.max = null;
    if (want.has("avg")) aggregations.avg = null;
    if (want.has("latest")) aggregations.latest = null;
  }

  const take = storeSamples && n > 0 ? Math.min(n, maxSamplesToStore) : 0;
  const samplesOut = storeSamples && n > 0 ? scaled.slice(n - take) : [];

  const meta: Record<string, unknown> = {
    unit: typeof unit === "string" || unit == null ? unit : String(unit),
    data_type: dataType,
    sample_rate_hz: sampleRateHz ?? null,
    source_mode: mode,
  };
  if (!storeSamples) {
    meta.sample_count = n;
    meta.samples_stored = false;
  }

  return { samples: samplesOut, meta, aggregations };
}

/** Mutates `payload` like the Python engine. */
export function applyDecodeSeriesSteps(payload: Record<string, unknown>, steps: unknown): void {
  if (!Array.isArray(steps) || steps.length === 0) return;
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const st = step as Record<string, unknown>;
    if (String(pick(st, "step_type", "stepType") ?? "").trim() !== "decode_series") continue;
    const src = String(pick(st, "source_path", "sourcePath") ?? "").trim();
    const tgt = String(pick(st, "target_path", "targetPath") ?? "").trim();
    try {
      const out = decodeOneStep(st, payload);
      setDotted(payload, tgt, out);
    } catch (e) {
      const code = e instanceof Error && e.message in MSG ? e.message : "NON_NUMERIC_VALUE";
      setDotted(payload, tgt, { _error: errorBlob(src, code, MSG[code] ?? code) });
    }
  }
}
