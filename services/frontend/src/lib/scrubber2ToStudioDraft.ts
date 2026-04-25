/**
 * Translate Scrubber 2.0 internal model → legacy `scrubberStudio.draft` shape
 * consumed by `run_scrubber` / POST `/scrubber/preview` (no changes to API).
 */

import type { Scrubber2Model } from "@/types/scrubber2Model";
import { collectFieldPaths } from "@/lib/scrubber2Fields";

function dropsFromKeep(allLeaves: readonly string[], keep: Set<string>): string[] {
  if (keep.size === 0 && allLeaves.length > 0) return [...allLeaves];
  return allLeaves.filter((leaf) => {
    for (const k of keep) {
      if (leaf === k || leaf.startsWith(`${k}.`)) return false;
    }
    return true;
  });
}

function windowsFromWindowToken(win: string): { win1h: boolean; win24h: boolean } {
  const w = (win || "").toLowerCase();
  if (w.includes("24")) return { win1h: false, win24h: true };
  if (w.includes("1h") || w === "60m" || w.includes("hour")) return { win1h: true, win24h: false };
  return { win1h: true, win24h: true };
}

function buildHealthBlock(m: Scrubber2Model["health"]): unknown {
  const { mode, config } = m;
  if (mode === "incoming_field") {
    const source = typeof config.source_field === "string" ? config.source_field.trim() : "";
    const mapping: Record<string, string> = {};
    const rawMap = config.mapping;
    if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
      for (const [k, v] of Object.entries(rawMap as Record<string, unknown>)) {
        const st = String(v || "").toLowerCase();
        mapping[k] = st === "green" || st === "yellow" || st === "red" ? st : "yellow";
      }
    }
    return {
      mode: "map",
      source_field: source,
      mapping,
      message_from: typeof config.message_from === "string" ? config.message_from.trim() : undefined,
    };
  }
  if (mode === "threshold_reference_json") {
    let definition: Record<string, unknown>;
    const def = config.definition;
    if (def && typeof def === "object" && !Array.isArray(def)) definition = { ...(def as Record<string, unknown>) };
    else {
      try {
        definition = JSON.parse(String(config.inline_json || "{}")) as Record<string, unknown>;
      } catch {
        definition = { reference_name: "invalid_json", normal: {}, warning: {}, critical: {} };
      }
    }
    return {
      mode: "thresholds",
      definition,
      ...(typeof config.reference_id === "string" && config.reference_id.trim()
        ? { reference_id: config.reference_id.trim() }
        : {}),
    };
  }
  const rulesRaw = config.rules;
  const rules: unknown[] = Array.isArray(rulesRaw) ? rulesRaw : [];
  const mapped = rules
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const r = x as Record<string, unknown>;
      const cond = String(r.condition || "").trim();
      if (!cond) return null;
      const st = String(r.status || "yellow").toLowerCase();
      return {
        name: String(r.name || "rule").trim() || "rule",
        condition: cond,
        status: ["green", "yellow", "red"].includes(st) ? st : "yellow",
        priority: parseInt(String(r.priority ?? "0"), 10) || 0,
        code: String(r.code || "").trim(),
        message: String(r.message || "").trim(),
      };
    })
    .filter(Boolean);
  return {
    mode: "rules",
    default_status: String(config.default_status || "green").toLowerCase(),
    rules: mapped,
  };
}

export function buildStudioDraftFromV2(
  model: Scrubber2Model,
  ctx: { objectName: string; parseAs?: "auto" | "json" | "text"; selectPath?: string },
  samplePayload: Record<string, unknown>,
): Record<string, unknown> {
  const allLeaves = collectFieldPaths(samplePayload);
  const keep = new Set(model.keepFields.filter(Boolean));
  const dropPaths = dropsFromKeep(allLeaves, keep);

  const attrLiterals: Record<string, unknown> = {};
  const attrFp: Record<string, string> = {};
  for (const row of model.attributes) {
    const k = row.key.trim();
    if (!k) continue;
    if (row.mode === "literal") attrLiterals[k] = row.value !== undefined ? row.value : "";
    else if (row.mode === "copy" && row.sourcePath?.trim()) attrFp[k] = row.sourcePath.trim();
  }

  const scalars: { name: string; fromPath?: string; literal?: unknown }[] = [];
  for (const row of model.normalize.renames) {
    const fp = row.from.trim();
    const tn = row.to.trim();
    if (fp && tn) scalars.push({ name: tn, fromPath: fp });
  }

  const metricsObj: Record<string, unknown> = {};
  const metricPaths = new Set(
    model.fieldSemantics.filter((s) => s.roles?.includes("metric")).map((s) => s.path.trim()),
  );
  for (const row of model.kpi.metrics) {
    const path = row.path.trim();
    if (!path || !metricPaths.has(path)) continue;
    const { win1h, win24h } = windowsFromWindowToken(row.window);
    const windows: string[] = [];
    if (win1h) windows.push("1h");
    if (win24h) windows.push("24h");
    metricsObj[path] = {
      type: row.aggregation?.trim() || "numeric",
      store_history: true,
      windows: windows.length ? windows : ["1h", "24h"],
      unit: row.rollup?.trim() || undefined,
      label: undefined,
      field: path,
    };
  }

  const displayFields = model.fieldSemantics
    .filter((s) => s.roles?.includes("display"))
    .map((s) => s.path.trim())
    .filter(Boolean);

  const kpi = {
    displayFields,
    metrics: metricsObj,
  };

  const loc = model.location;
  const gpsEnabled = Boolean(loc.latitudePath?.trim() && loc.longitudePath?.trim());

  const health = buildHealthBlock(model.health);

  const out: Record<string, unknown> = {
    parseAs: ctx.parseAs ?? "auto",
    objectName: ctx.objectName.trim() || "data_object",
    dropPaths,
    flatten: { enabled: model.normalize.flatten, delimiter: "_" },
    addAttributes: { literals: attrLiterals, fromPayload: attrFp },
    scalarFields: scalars,
    functionBased: {
      enabled: model.derived.enabled,
      code: model.derived.code,
      timeoutMs: 200,
    },
    gpsMapping: {
      enabled: gpsEnabled,
      sourceMode: "path",
      latitudePath: loc.latitudePath?.trim() || undefined,
      longitudePath: loc.longitudePath?.trim() || undefined,
      altitudePath: loc.altitudePath?.trim() || undefined,
      headingPath: loc.headingPath?.trim() || undefined,
    },
    health,
    healthDisplay: {
      enabled: true,
      statusKey: "health_status",
      codeKey: "health_code",
      messageKey: "health_message",
      detailsKey: "health_details",
    },
    kpi,
  };
  if (model.fieldSemantics.length) {
    out.fieldSemantics = model.fieldSemantics;
  }
  if (ctx.selectPath?.trim()) out.selectPath = ctx.selectPath.trim();
  return out;
}

export function buildScrubberStudioMappingForPreview(
  model: Scrubber2Model,
  ctx: { objectName: string; version: string; parseAs?: "auto" | "json" | "text"; selectPath?: string },
  samplePayload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    scrubberStudio: {
      published: false,
      version: ctx.version,
      draft: buildStudioDraftFromV2(model, ctx, samplePayload),
    },
  };
}

export function bumpSemverLike(v: string): string {
  const t = v.trim();
  if (/^\d+$/.test(t)) return String(Number(t) + 1);
  if (!t) return "1";
  return `${t}-bump`;
}
