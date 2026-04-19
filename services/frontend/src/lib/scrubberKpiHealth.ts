/** Client-side KPI + health evaluation (aligned with API scrubber_kpi_service / scrubber_health_service). */

export type HealthEvalResult = {
  status: string;
  code: string;
  message: string;
  details: Record<string, unknown>;
};

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getByPath(obj: unknown, dotted: string): unknown {
  if (!dotted.trim()) return obj;
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (!part) continue;
    if (!isObjectRecord(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function buildKpiOutput(template: unknown, payload: Record<string, unknown>): Record<string, unknown> {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return { displayFields: {}, metrics: {} };
  }
  const t = template as Record<string, unknown>;
  if ("displayFields" in t || "metrics" in t) {
    const displayPaths = Array.isArray(t.displayFields) ? (t.displayFields as unknown[]).filter((x) => typeof x === "string") as string[] : [];
    const displayObj: Record<string, unknown> = {};
    for (const p of displayPaths) {
      const path = p.trim();
      if (!path) continue;
      displayObj[path] = getByPath(payload, path);
    }
    const metricsOut: Record<string, unknown> = {};
    const ms = t.metrics;
    if (ms && typeof ms === "object" && !Array.isArray(ms)) {
      for (const [fieldKey, meta] of Object.entries(ms as Record<string, unknown>)) {
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
        const m = meta as Record<string, unknown>;
        if (m.track === false || m.store_history === false) continue;
        const path = String(m.field || fieldKey).trim();
        if (!path) continue;
        const rawVal = getByPath(payload, path);
        const num = coerceFloat(rawVal);
        const windows = Array.isArray(m.windows) ? m.windows.map(String) : ["1h", "24h"];
        metricsOut[fieldKey] = {
          type: String(m.type || "numeric"),
          value: num,
          raw: rawVal,
          unit: m.unit,
          label: m.label,
          windows,
          store_history: m.store_history !== false,
        };
      }
    }
    return { displayFields: displayObj, metrics: metricsOut };
  }
  if ("literals" in t || "fromPayload" in t) {
    const display: Record<string, unknown> = {};
    const lit = t.literals;
    if (lit && typeof lit === "object" && !Array.isArray(lit)) {
      Object.assign(display, lit as Record<string, unknown>);
    }
    const fp = t.fromPayload;
    if (fp && typeof fp === "object" && !Array.isArray(fp)) {
      for (const [k, pathVal] of Object.entries(fp as Record<string, unknown>)) {
        if (typeof pathVal !== "string" || !pathVal.trim()) continue;
        const v = getByPath(payload, pathVal.trim());
        if (v !== undefined) display[k] = v;
      }
    }
    return { displayFields: display, metrics: {} };
  }
  return { displayFields: {}, metrics: {} };
}

function coerceFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (typeof val === "number") return val;
  const n = parseFloat(String(val).trim());
  return Number.isFinite(n) ? n : null;
}

const SEV: Record<string, number> = { red: 3, yellow: 2, green: 1 };

const TH_BAND_RANK: Record<string, number> = { critical: 3, warning: 2, normal: 1, unknown: 0 };
const TH_TO_DISPLAY: Record<string, string> = {
  critical: "red",
  warning: "yellow",
  normal: "green",
  unknown: "yellow",
};

function normStatus(s: string): string {
  const x = s.toLowerCase().trim();
  return x === "green" || x === "yellow" || x === "red" ? x : "yellow";
}

/** Minimal rule condition evaluator — supports comparisons, and, or, parentheses (matches server subset). */
export function evalRuleCondition(expr: string, payload: Record<string, unknown>): boolean {
  const e = expr.trim();
  if (!e) return false;
  try {
    return parseAndEval(e, payload);
  } catch {
    return false;
  }
}

function parseAndEval(s: string, payload: Record<string, unknown>): boolean {
  const toks = tokenize(s);
  const [ast, pos] = parseOr(toks, 0);
  if (pos !== toks.length) throw new Error("trailing");
  return evalAst(ast, payload);
}

type Tok = { k: string; v?: string | number };
function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    if (s[i] === "(" || s[i] === ")") {
      out.push({ k: "paren", v: s[i] });
      i++;
      continue;
    }
    if (i + 1 < n && [">=", "<=", "==", "!="].includes(s.slice(i, i + 2))) {
      out.push({ k: "op", v: s.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if (s[i] === ">" || s[i] === "<") {
      out.push({ k: "op", v: s[i] });
      i++;
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      i++;
      let buf = "";
      while (i < n && s[i] !== q) {
        buf += s[i];
        i++;
      }
      if (i >= n) throw new Error("string");
      i++;
      out.push({ k: "str", v: buf });
      continue;
    }
    if (/[\d.]/.test(s[i])) {
      let j = i;
      while (j < n && /[\d.]/.test(s[j])) j++;
      out.push({ k: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && /[\w.]/.test(s[j])) j++;
    const word = s.slice(i, j);
    if (!word) throw new Error("?");
    const lw = word.toLowerCase();
    if (lw === "and") out.push({ k: "and" });
    else if (lw === "or") out.push({ k: "or" });
    else out.push({ k: "ident", v: word });
    i = j;
  }
  return out;
}

type Ast = unknown;

function parsePrimary(toks: Tok[], i: number): [Ast, number] {
  if (i >= toks.length) throw new Error("end");
  const t = toks[i];
  if (t.k === "num") return [{ t: "lit", v: t.v }, i + 1];
  if (t.k === "str") return [{ t: "lit", v: t.v }, i + 1];
  if (t.k === "ident") return [{ t: "path", p: String(t.v) }, i + 1];
  if (t.k === "paren" && t.v === "(") {
    const [node, j] = parseOr(toks, i + 1);
    if (j >= toks.length || toks[j].k !== "paren" || toks[j].v !== ")") throw new Error(")");
    return [node, j + 1];
  }
  throw new Error("primary");
}

function parseComparison(toks: Tok[], i: number): [Ast, number] {
  const [left, j] = parsePrimary(toks, i);
  if (j < toks.length && toks[j].k === "op") {
    const op = String(toks[j].v);
    const [right, k] = parsePrimary(toks, j + 1);
    return [{ t: "cmp", left, op, right }, k];
  }
  return [left, j];
}

function parseAnd(toks: Tok[], i: number): [Ast, number] {
  let [left, j] = parseComparison(toks, i);
  while (j < toks.length && toks[j].k === "and") {
    const [right, k] = parseComparison(toks, j + 1);
    left = { t: "and", left, right };
    j = k;
  }
  return [left, j];
}

function parseOr(toks: Tok[], i: number): [Ast, number] {
  let [left, j] = parseAnd(toks, i);
  while (j < toks.length && toks[j].k === "or") {
    const [right, k] = parseAnd(toks, j + 1);
    left = { t: "or", left, right };
    j = k;
  }
  return [left, j];
}

function valOf(node: Ast, payload: Record<string, unknown>): unknown {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const o = node as Record<string, unknown>;
    if (o.t === "path") return getByPath(payload, String(o.p));
    if (o.t === "lit") return o.v;
  }
  return node;
}

function cmpVals(a: unknown, b: unknown, op: string): boolean {
  const na = coerceFloat(a);
  const nb = coerceFloat(b);
  if (na !== null && nb !== null) {
    if (op === ">") return na > nb;
    if (op === "<") return na < nb;
    if (op === ">=") return na >= nb;
    if (op === "<=") return na <= nb;
    if (op === "==") return na === nb;
    if (op === "!=") return na !== nb;
  }
  const sa = a === null || a === undefined ? "" : String(a);
  const sb = b === null || b === undefined ? "" : String(b);
  if (op === "==") return sa === sb;
  if (op === "!=") return sa !== sb;
  return false;
}

function evalAst(node: Ast, payload: Record<string, unknown>): boolean {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const o = node as Record<string, unknown>;
    if (o.t === "and") return evalAst(o.left, payload) && evalAst(o.right, payload);
    if (o.t === "or") return evalAst(o.left, payload) || evalAst(o.right, payload);
    if (o.t === "cmp") {
      const a = valOf(o.left, payload);
      const b = valOf(o.right, payload);
      return cmpVals(a, b, String(o.op));
    }
    if (o.t === "path") {
      const v = getByPath(payload, String(o.p));
      if (v === undefined || v === null || v === "") return false;
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      return String(v) !== "";
    }
  }
  return Boolean(node);
}

function evaluateHealthMap(spec: Record<string, unknown>, payload: Record<string, unknown>): HealthEvalResult {
  const source = String(spec.source_field || "").trim();
  const mapping = spec.mapping && typeof spec.mapping === "object" && !Array.isArray(spec.mapping) ? (spec.mapping as Record<string, unknown>) : {};
  const msgFrom = String(spec.message_from || "").trim();
  const raw = source ? getByPath(payload, source) : undefined;
  const key = raw !== undefined && raw !== null ? String(raw) : "";
  let mapped = mapping[key];
  if (mapped === undefined && raw !== undefined) mapped = mapping[String(raw)];
  const status = normStatus(String(mapped ?? "yellow"));
  let message = "";
  if (msgFrom) {
    const mv = getByPath(payload, msgFrom);
    if (mv !== undefined && mv !== null) message = String(mv);
  }
  const details: Record<string, unknown> = {
    mode: "map",
    source_field: source,
    raw_value: raw !== undefined && raw !== null && (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") ? raw : raw != null ? String(raw) : null,
    mapped_status: status,
  };
  if (msgFrom) details.message_from_field = msgFrom;
  return { status, code: String(spec.default_code || "mapped"), message, details };
}

function evaluateHealthRules(spec: Record<string, unknown>, payload: Record<string, unknown>): HealthEvalResult {
  const defaultStatus = normStatus(String(spec.default_status || "green"));
  const rules = Array.isArray(spec.rules) ? spec.rules : [];
  const matches: { sev: number; pr: number; status: string; code: string; message: string; name: string }[] = [];
  for (const r of rules) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const row = r as Record<string, unknown>;
    const cond = String(row.condition || "").trim();
    if (!cond) continue;
    if (!evalRuleCondition(cond, payload)) continue;
    const st = normStatus(String(row.status || "yellow"));
    const sev = SEV[st] ?? 1;
    const pr = typeof row.priority === "number" ? row.priority : parseInt(String(row.priority || 0), 10) || 0;
    matches.push({
      sev,
      pr,
      status: st,
      code: String(row.code || ""),
      message: String(row.message || ""),
      name: String(row.name || ""),
    });
  }
  if (matches.length === 0) {
    return {
      status: defaultStatus,
      code: "default",
      message: "No rule matched",
      details: { mode: "simple_rules", matched: null },
    };
  }
  matches.sort((a, b) => b.sev - a.sev || b.pr - a.pr);
  const w = matches[0];
  return {
    status: w.status,
    code: w.code || "rule",
    message: w.message,
    details: { mode: "simple_rules", matched: { name: w.name, code: w.code, message: w.message, status: w.status } },
  };
}

function matchesBand(val: number, band: Record<string, unknown>): boolean {
  if (!band || typeof band !== "object") return false;
  let ok = true;
  if ("min" in band) ok = ok && val >= Number(band["min"]);
  if ("max" in band) ok = ok && val <= Number(band["max"]);
  if ("min_exclusive" in band) ok = ok && val > Number(band["min_exclusive"]);
  if ("max_exclusive" in band) ok = ok && val < Number(band["max_exclusive"]);
  return ok;
}

function bandForField(
  fieldKey: string,
  normal: Record<string, unknown>,
  warning: Record<string, unknown>,
  critical: Record<string, unknown>,
  payload: Record<string, unknown>,
): { band: string; val: number | null } {
  const specCrit = critical[fieldKey];
  const specWarn = warning[fieldKey];
  const specNorm = normal[fieldKey];
  const val = coerceFloat(getByPath(payload, fieldKey));
  if (val === null) return { band: "unknown", val: null };
  const c = isObjectRecord(specCrit) ? specCrit : null;
  const w = isObjectRecord(specWarn) ? specWarn : null;
  const n = isObjectRecord(specNorm) ? specNorm : null;
  if (c && matchesBand(val, c)) return { band: "critical", val };
  if (w && matchesBand(val, w)) return { band: "warning", val };
  if (n && matchesBand(val, n)) return { band: "normal", val };
  return { band: "unknown", val };
}

function evaluateHealthThresholds(spec: Record<string, unknown>, payload: Record<string, unknown>): HealthEvalResult {
  const definition = spec.definition;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    return {
      status: "yellow",
      code: "thresholds_invalid",
      message: "Missing or invalid thresholds definition",
      details: { mode: "thresholds", error: "no_definition" },
    };
  }
  const def = definition as Record<string, unknown>;
  const refName = String(def.reference_name || "thresholds");
  const normal = isObjectRecord(def.normal) ? def.normal : {};
  const warning = isObjectRecord(def.warning) ? def.warning : {};
  const critical = isObjectRecord(def.critical) ? def.critical : {};

  const keys = new Set<string>();
  for (const d of [normal, warning, critical]) {
    for (const [k, v] of Object.entries(d)) {
      if (isObjectRecord(v)) keys.add(k);
    }
  }

  if (keys.size === 0) {
    return {
      status: "green",
      code: "thresholds:empty",
      message: "No threshold fields defined",
      details: { mode: "thresholds", reference_name: refName, overall_severity: "normal", fields: [] },
    };
  }

  const fieldRows: { path: string; value: number | null; band: string; display_severity: string }[] = [];
  let worstRank = 0;
  for (const fk of [...keys].sort()) {
    const { band, val } = bandForField(fk, normal, warning, critical, payload);
    worstRank = Math.max(worstRank, TH_BAND_RANK[band] ?? 0);
    fieldRows.push({
      path: fk,
      value: val,
      band,
      display_severity: TH_TO_DISPLAY[band] ?? "yellow",
    });
  }

  const overallLabels = ["unknown", "normal", "warning", "critical"] as const;
  const overall =
    worstRank >= 0 && worstRank < overallLabels.length ? overallLabels[worstRank] : "unknown";
  const displayStatus = TH_TO_DISPLAY[overall] ?? "yellow";
  const status = normStatus(displayStatus);

  const worstLabels = fieldRows.filter((r) => r.band === overall && overall !== "normal").map((r) => r.path);
  let message: string;
  if (overall === "normal" && fieldRows.length) message = `All sampled fields within normal bands (${refName})`;
  else if (overall === "unknown") message = `One or more fields did not match any band (${refName})`;
  else message = `${overall}: ${worstLabels.slice(0, 8).join(", ")}${worstLabels.length > 8 ? "…" : ""}`;

  const code = `thresholds:${refName}:${overall}`;
  const details: Record<string, unknown> = {
    mode: "thresholds",
    reference_name: refName,
    overall_severity: overall,
    fields: fieldRows,
  };
  return { status, code, message, details };
}

function evalHealthLegacyList(rules: unknown[], payload: Record<string, unknown>): HealthEvalResult {
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const r = rule as Record<string, unknown>;
    const when = r.when;
    if (typeof when === "string" && when.startsWith("missing:")) {
      const path = when.slice("missing:".length).trim();
      const v = getByPath(payload, path);
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
        return {
          status: normStatus(String(r.status || "yellow")),
          code: String(r.code || "missing"),
          message: String(r.message || `Missing ${path}`),
          details: { mode: "legacy", matched: "missing", path },
        };
      }
    }
    if (typeof when === "string" && when.startsWith("match:")) {
      const rest = when.slice("match:".length).trim();
      const m = /^(\S+)\s+(.+)$/.exec(rest);
      if (m) {
        const path = m[1];
        const pattern = m[2];
        const val = getByPath(payload, path);
        if (val != null) {
          try {
            const re = new RegExp(pattern);
            if (re.test(String(val))) {
              return {
                status: normStatus(String(r.status || "red")),
                code: String(r.code || "match"),
                message: String(r.message || "Pattern matched"),
                details: { mode: "legacy", matched: "match", path },
              };
            }
          } catch {
            /* skip */
          }
        }
      }
    }
  }
  return {
    status: "green",
    code: "ok",
    message: "All rules passed",
    details: { mode: "legacy", matched: null },
  };
}

export function evaluateHealth(healthSpec: unknown, payload: Record<string, unknown>): HealthEvalResult {
  if (!healthSpec) return { status: "green", code: "ok", message: "", details: { mode: "none" } };
  if (Array.isArray(healthSpec)) return evalHealthLegacyList(healthSpec, payload);
  if (!isObjectRecord(healthSpec)) return { status: "green", code: "ok", message: "", details: { mode: "none" } };
  const h = healthSpec as Record<string, unknown>;
  const mode = String(h.mode || "").toLowerCase();
  if (mode === "map") return evaluateHealthMap(h, payload);
  if (mode === "rules") return evaluateHealthRules(h, payload);
  if (mode === "thresholds") return evaluateHealthThresholds(h, payload);
  const rules = h.rules;
  if (Array.isArray(rules) && rules[0] && isObjectRecord(rules[0]) && "condition" in (rules[0] as object)) {
    return evaluateHealthRules({ ...h, mode: "rules" }, payload);
  }
  if ("status" in h) {
    const st = normStatus(String(h.status || "green"));
    return {
      status: st,
      code: String(h.code || "ok"),
      message: String(h.message || ""),
      details: { mode: "static", status: st },
    };
  }
  return { status: "green", code: "ok", message: "", details: { mode: "none" } };
}
