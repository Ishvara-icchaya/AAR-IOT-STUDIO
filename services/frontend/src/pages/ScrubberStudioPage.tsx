import type { CSSProperties, Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { jsPDF } from "jspdf";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/api/client";
import { PageStatus } from "@/components/PageStatus";
import { ScrubberPipelineHelpModal } from "@/components/scrubber/ScrubberPipelineHelpModal";
import { HealthStepEditor } from "@/components/scrubber/HealthStepEditor";
import { KpiStepEditor } from "@/components/scrubber/KpiStepEditor";
import { PageShell } from "@/layouts/PageShell";
import { buildKpiOutput, evaluateHealth } from "@/lib/scrubberKpiHealth";
import type { PipelineStepId } from "@/types/scrubberPipeline";
import type { StudioDraftForm } from "@/types/scrubberStudioForm";

export type { PipelineStepId, StudioDraftForm };

type VerifyResp = {
  raw_object_id: string;
  device_id: string;
  storage_key: string;
  size_bytes: number | null;
  minio_exists: boolean;
  verify_status?: string | null;
  ingest_status?: string | null;
  /** Server: this raw is newest for device (ordering matches raw list). */
  is_latest_for_device?: boolean;
};

type RawPreviewResp = {
  raw_object_id: string;
  encoding: "utf8" | "base64";
  text: string | null;
  base64: string | null;
  truncated: boolean;
  returned_bytes: number;
};

type RawListHeadResp = {
  items: Array<{ id: string; ingested_at: string | null }>;
  total: number;
};

/** Compare UUID strings from URL vs API (casing may differ). */
function uuidEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

type ScrubberPreviewResp = {
  raw_object_id: string;
  device_id: string;
  preview: {
    object_name: string;
    output_payload: Record<string, unknown>;
    kpi: Record<string, unknown>;
    health_status: string;
    health_code: string;
    health_message: string;
    scrubber_version?: string | null;
  };
  error: string | null;
};

const STEPS: { id: PipelineStepId; label: string; hint: string }[] = [
  { id: "drop", label: "Drop", hint: "Remove dotted paths from the working object (tabular or freeform)." },
  { id: "addAttributes", label: "Add attributes", hint: "Merge literals or copy scalar branches from the payload." },
  { id: "scalars", label: "Derived Fields", hint: "Deterministic scalar top-level fields (path or literal only)." },
  { id: "functionBased", label: "Function Based", hint: "Optional Python transform(payload) that returns extra scalar fields." },
  { id: "gps", label: "Location / GPS mapping", hint: "Map payload fields into normalized gps.* coordinates with validation." },
  { id: "health", label: "Health mapping", hint: "Map upstream status or rule expressions with precedence; normalized to dashboard fields." },
  { id: "kpi", label: "KPI definition", hint: "Display fields for dashboard click + numeric metrics for time-series (1h/24h config)." },
];

const PATH_HINTS_DATALIST_ID = "scrubber-studio-path-hints";

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

function flattenOneLevel(input: Record<string, unknown>, delimiter: string): Record<string, unknown> {
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

/** Repeated one-level flatten until stable (matches API/worker `flatten.enabled`). */
function flattenComplete(input: Record<string, unknown>, delimiter: string, maxRounds = 64): Record<string, unknown> {
  let p: Record<string, unknown> = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  const delim = delimiter || "_";
  for (let i = 0; i < maxRounds; i++) {
    const nxt = flattenOneLevel(p, delim);
    if (JSON.stringify(nxt) === JSON.stringify(p)) return nxt;
    p = nxt;
  }
  return p;
}

function deletePath(obj: Record<string, unknown>, dotted: string): void {
  const parts = dotted.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: unknown = obj;
  for (const p of parts.slice(0, -1)) {
    if (!isObjectRecord(cur) || !(p in cur)) return;
    cur = cur[p];
  }
  if (isObjectRecord(cur)) delete cur[parts[parts.length - 1]];
}

function collectLeafPaths(value: unknown, parent = "", depth = 0): string[] {
  if (depth > 8) return [];
  if (isObjectRecord(value)) {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      const p = parent ? `${parent}.${k}` : k;
      if (isObjectRecord(v)) out.push(...collectLeafPaths(v, p, depth + 1));
      else if (Array.isArray(v)) out.push(p);
      else out.push(p);
    }
    return out;
  }
  return parent ? [parent] : [];
}

function defaultStudioForm(): StudioDraftForm {
  return {
    parseAs: "auto",
    objectName: "data_object",
    selectPath: "",
    dropPathsText: "",
    flattenEnabled: false,
    flattenDelimiter: "_",
    attrLiterals: [{ key: "", value: "" }],
    attrFromPayload: [{ key: "", path: "" }],
    scalarRows: [{ name: "", mode: "path", path: "", literal: "" }],
    functionBasedEnabled: false,
    functionBasedCode:
      "def transform(payload):\n    # return only scalar top-level fields\n    return {\n        \"device_label\": upper(str(payload.get(\"device\", \"\"))),\n        \"temp_rounded\": round(float(payload.get(\"temperature\", 0)), 1),\n    }\n",
    functionBasedTimeoutMs: 200,
    gpsEnabled: false,
    gpsSourceMode: "path",
    gpsLatitudePath: "",
    gpsLongitudePath: "",
    gpsStaticLatitude: "",
    gpsStaticLongitude: "",
    gpsAltitudePath: "",
    gpsHeadingPath: "",
    gpsSpeedPath: "",
    gpsTimestampPath: "",
    healthEngineMode: "rules",
    healthMapSourceField: "",
    healthMapPairs: [
      { incoming: "OK", outStatus: "green" },
      { incoming: "WARN", outStatus: "yellow" },
      { incoming: "FAIL", outStatus: "red" },
    ],
    healthMapMessageFrom: "",
    healthRulesDefault: "green",
    healthRulesV2: [
      { name: "example", condition: "", status: "yellow", priority: "50", code: "", message: "" },
    ],
    healthDisplayEnabled: true,
    healthStatusKey: "health_status",
    healthCodeKey: "health_code",
    healthMessageKey: "health_message",
    healthRawLegacy: null,
    kpiDisplayFields: [],
    kpiMetrics: [],
  };
}

function parseCellJson(s: string): unknown {
  const t = s.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return s;
  }
}

function formToActiveDraft(form: StudioDraftForm): Record<string, unknown> {
  const dropPaths = form.dropPathsText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const attrLiterals: Record<string, unknown> = {};
  for (const row of form.attrLiterals) {
    const k = row.key.trim();
    if (!k) continue;
    attrLiterals[k] = parseCellJson(row.value);
  }
  const attrFp: Record<string, string> = {};
  for (const row of form.attrFromPayload) {
    const k = row.key.trim();
    const p = row.path.trim();
    if (k && p) attrFp[k] = p;
  }
  const scalars: { name: string; fromPath?: string; literal?: unknown }[] = [];
  for (const row of form.scalarRows) {
    const n = row.name.trim();
    if (!n) continue;
    if (row.mode === "literal") scalars.push({ name: n, literal: parseCellJson(row.literal) });
    else if (row.path.trim()) scalars.push({ name: n, fromPath: row.path.trim() });
  }
  let health: unknown;
  if (form.healthRawLegacy != null) {
    health = form.healthRawLegacy;
  } else if (form.healthEngineMode === "map") {
    const mapping: Record<string, string> = {};
    for (const row of form.healthMapPairs) {
      const ink = row.incoming.trim();
      if (!ink) continue;
      const st = row.outStatus.toLowerCase();
      mapping[ink] = st === "green" || st === "yellow" || st === "red" ? st : "yellow";
    }
    health = {
      mode: "map",
      source_field: form.healthMapSourceField.trim(),
      mapping,
      message_from: form.healthMapMessageFrom.trim() || undefined,
    };
  } else {
    health = {
      mode: "rules",
      default_status: form.healthRulesDefault,
      rules: form.healthRulesV2
        .filter((r) => r.condition.trim())
        .map((r) => ({
          name: r.name.trim() || "rule",
          condition: r.condition.trim(),
          status: (["green", "yellow", "red"].includes(r.status.toLowerCase()) ? r.status : "yellow").toLowerCase(),
          priority: parseInt(r.priority, 10) || 0,
          code: r.code.trim(),
          message: r.message.trim(),
        })),
    };
  }

  const metricsObj: Record<string, unknown> = {};
  for (const row of form.kpiMetrics) {
    const path = row.fieldPath.trim();
    if (!path || !row.storeHistory) continue;
    const windows: string[] = [];
    if (row.win1h) windows.push("1h");
    if (row.win24h) windows.push("24h");
    metricsObj[path] = {
      type: row.type || "numeric",
      store_history: row.storeHistory,
      windows: windows.length ? windows : ["1h", "24h"],
      unit: row.unit.trim() || undefined,
      label: row.label.trim() || undefined,
      field: path,
    };
  }
  const kpi = {
    displayFields: [...form.kpiDisplayFields],
    metrics: metricsObj,
  };

  const out: Record<string, unknown> = {
    parseAs: form.parseAs,
    objectName: form.objectName.trim() || "Data object",
    dropPaths,
    flatten: { enabled: form.flattenEnabled, delimiter: form.flattenDelimiter || "_" },
    addAttributes: { literals: attrLiterals, fromPayload: attrFp },
    scalarFields: scalars,
    functionBased: {
      enabled: form.functionBasedEnabled,
      code: form.functionBasedCode,
      timeoutMs: form.functionBasedTimeoutMs,
    },
    gpsMapping: {
      enabled: form.gpsEnabled,
      sourceMode: form.gpsSourceMode,
      latitudePath: form.gpsLatitudePath.trim() || undefined,
      longitudePath: form.gpsLongitudePath.trim() || undefined,
      staticLatitude: form.gpsStaticLatitude.trim() || undefined,
      staticLongitude: form.gpsStaticLongitude.trim() || undefined,
      altitudePath: form.gpsAltitudePath.trim() || undefined,
      headingPath: form.gpsHeadingPath.trim() || undefined,
      speedPath: form.gpsSpeedPath.trim() || undefined,
      timestampPath: form.gpsTimestampPath.trim() || undefined,
    },
    health,
    healthDisplay: {
      enabled: form.healthDisplayEnabled,
      statusKey: form.healthStatusKey.trim() || "health_status",
      codeKey: form.healthCodeKey.trim() || "health_code",
      messageKey: form.healthMessageKey.trim() || "health_message",
    },
    kpi,
  };
  if (form.selectPath.trim()) out.selectPath = form.selectPath.trim();
  return out;
}

function activeDraftToForm(d: Record<string, unknown>): StudioDraftForm {
  const f = defaultStudioForm();
  const parseAs = d.parseAs;
  if (parseAs === "json" || parseAs === "text" || parseAs === "auto") f.parseAs = parseAs;
  if (typeof d.objectName === "string") {
    let on = d.objectName.trim();
    if (!/^(.+)_(\d{10,})$/.test(on)) {
      const base = on.replace(/\s+/g, "_") || "data_object";
      on = `${base}_${Date.now()}`;
    }
    f.objectName = on;
  }
  if (typeof d.selectPath === "string") f.selectPath = d.selectPath;
  if (Array.isArray(d.dropPaths)) f.dropPathsText = d.dropPaths.filter((x) => typeof x === "string").join("\n");
  const flat = d.flatten;
  if (flat && typeof flat === "object" && !Array.isArray(flat)) {
    const fl = flat as Record<string, unknown>;
    f.flattenEnabled = Boolean(fl.enabled);
    if (typeof fl.delimiter === "string") f.flattenDelimiter = fl.delimiter;
  }
  const add = d.addAttributes;
  if (add && typeof add === "object" && !Array.isArray(add)) {
    const a = add as Record<string, unknown>;
    const lit = a.literals;
    if (lit && typeof lit === "object" && !Array.isArray(lit)) {
      f.attrLiterals = Object.entries(lit as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }));
      if (f.attrLiterals.length === 0) f.attrLiterals = [{ key: "", value: "" }];
    }
    const fp = a.fromPayload;
    if (fp && typeof fp === "object" && !Array.isArray(fp)) {
      f.attrFromPayload = Object.entries(fp as Record<string, string>).map(([key, path]) => ({ key, path }));
      if (f.attrFromPayload.length === 0) f.attrFromPayload = [{ key: "", path: "" }];
    }
  }
  const sf = d.scalarFields;
  if (Array.isArray(sf)) {
    f.scalarRows = sf
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const r = x as Record<string, unknown>;
        const name = typeof r.name === "string" ? r.name : "";
        if ("literal" in r)
          return { name, mode: "literal" as const, path: "", literal: JSON.stringify(r.literal) };
        const p = typeof r.fromPath === "string" ? r.fromPath : "";
        return { name, mode: "path" as const, path: p, literal: "" };
      });
    if (f.scalarRows.length === 0) f.scalarRows = [{ name: "", mode: "path", path: "", literal: "" }];
  }
  const fb = d.functionBased;
  if (fb && typeof fb === "object" && !Array.isArray(fb)) {
    const o = fb as Record<string, unknown>;
    f.functionBasedEnabled = Boolean(o.enabled);
    if (typeof o.code === "string") f.functionBasedCode = o.code;
    if (typeof o.timeoutMs === "number") f.functionBasedTimeoutMs = Math.max(50, Math.min(2000, Math.trunc(o.timeoutMs)));
  }
  const gps = d.gpsMapping;
  if (gps && typeof gps === "object" && !Array.isArray(gps)) {
    const g = gps as Record<string, unknown>;
    f.gpsEnabled = Boolean(g.enabled);
    if (g.sourceMode === "path" || g.sourceMode === "static") f.gpsSourceMode = g.sourceMode;
    if (typeof g.latitudePath === "string") f.gpsLatitudePath = g.latitudePath;
    if (typeof g.longitudePath === "string") f.gpsLongitudePath = g.longitudePath;
    if (typeof g.staticLatitude === "string") f.gpsStaticLatitude = g.staticLatitude;
    if (typeof g.staticLongitude === "string") f.gpsStaticLongitude = g.staticLongitude;
    if (typeof g.altitudePath === "string") f.gpsAltitudePath = g.altitudePath;
    if (typeof g.headingPath === "string") f.gpsHeadingPath = g.headingPath;
    if (typeof g.speedPath === "string") f.gpsSpeedPath = g.speedPath;
    if (typeof g.timestampPath === "string") f.gpsTimestampPath = g.timestampPath;
  }
  const hd = d.healthDisplay;
  if (hd && typeof hd === "object" && !Array.isArray(hd)) {
    const h = hd as Record<string, unknown>;
    if (typeof h["enabled"] === "boolean") f.healthDisplayEnabled = h["enabled"];
    if (typeof h.statusKey === "string") f.healthStatusKey = h.statusKey;
    if (typeof h.codeKey === "string") f.healthCodeKey = h.codeKey;
    if (typeof h.messageKey === "string") f.healthMessageKey = h.messageKey;
  }
  const h = d.health;
  if (Array.isArray(h)) {
    f.healthRawLegacy = h;
  } else if (h && typeof h === "object" && !Array.isArray(h)) {
    const ho = h as Record<string, unknown>;
    const mode = String(ho.mode || "").toLowerCase();
    if (mode === "map") {
      f.healthEngineMode = "map";
      if (typeof ho.source_field === "string") f.healthMapSourceField = ho.source_field;
      const mp = ho.mapping;
      if (mp && typeof mp === "object" && !Array.isArray(mp)) {
        f.healthMapPairs = Object.entries(mp as Record<string, string>).map(([incoming, outStatus]) => ({
          incoming,
          outStatus: String(outStatus),
        }));
      }
      if (typeof ho.message_from === "string") f.healthMapMessageFrom = ho.message_from;
    } else if (mode === "rules" || (Array.isArray(ho.rules) && ho.rules.length)) {
      f.healthEngineMode = "rules";
      if (typeof ho.default_status === "string") f.healthRulesDefault = ho.default_status;
      const rules = Array.isArray(ho.rules) ? ho.rules : [];
      f.healthRulesV2 = rules
        .filter((r) => r && typeof r === "object")
        .map((r) => {
          const row = r as Record<string, unknown>;
          return {
            name: String(row.name ?? ""),
            condition: String(row.condition ?? ""),
            status: String(row.status ?? "yellow"),
            priority: String(row.priority ?? "0"),
            code: String(row.code ?? ""),
            message: String(row.message ?? ""),
          };
        });
      if (f.healthRulesV2.length === 0)
        f.healthRulesV2 = [{ name: "", condition: "", status: "yellow", priority: "50", code: "", message: "" }];
    } else if ("status" in ho && !("mode" in ho)) {
      f.healthRawLegacy = h;
    }
  }
  const kpi = d.kpi;
  if (kpi && typeof kpi === "object" && !Array.isArray(kpi)) {
    const k = kpi as Record<string, unknown>;
    const df = k.displayFields;
    if (Array.isArray(df)) {
      f.kpiDisplayFields = df.filter((x) => typeof x === "string") as string[];
    } else if (df && typeof df === "object" && !Array.isArray(df)) {
      f.kpiDisplayFields = Object.keys(df as Record<string, unknown>);
    }
    const metrics = k.metrics;
    if (metrics && typeof metrics === "object" && !Array.isArray(metrics)) {
      f.kpiMetrics = Object.entries(metrics as Record<string, unknown>).map(([key, meta]) => {
        const m = meta as Record<string, unknown>;
        const windows = Array.isArray(m.windows) ? m.windows.map(String) : [];
        return {
          fieldPath: String(m.field || key),
          storeHistory: m.store_history !== false,
          unit: String(m.unit ?? ""),
          label: String(m.label ?? ""),
          win1h: windows.includes("1h"),
          win24h: windows.includes("24h"),
          type: String(m.type || "numeric"),
        };
      });
    }
    const lit = k.literals;
    const fp = k.fromPayload;
    if ((lit && typeof lit === "object") || (fp && typeof fp === "object")) {
      const paths: string[] = [];
      if (fp && typeof fp === "object" && !Array.isArray(fp)) {
        for (const p of Object.values(fp as Record<string, string>)) {
          if (typeof p === "string" && p.trim()) paths.push(p.trim());
        }
      }
      if (f.kpiDisplayFields.length === 0 && paths.length) f.kpiDisplayFields = paths;
    }
  }
  return f;
}

function bumpVersion(v: string): string {
  const t = v.trim();
  if (/^\d+$/.test(t)) return String(Number(t) + 1);
  if (!t) return "1";
  return `${t}-bump`;
}

function safeJsonPreview(v: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(v, null, 2);
    if (s.length > maxLen) return `${s.slice(0, maxLen)}\n… (truncated)`;
    return s;
  } catch {
    return String(v);
  }
}

function healthColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "green") return "#2d8a4e";
  if (s === "yellow") return "#b8860b";
  if (s === "red") return "#c62828";
  return "var(--color-text-muted)";
}

/** Prefix before `_` + millisecond stamp (full value stored in `form.objectName`). */
function splitObjectNameUi(full: string): { prefix: string; stamp: number } {
  const m = /^(.+)_(\d{10,})$/.exec(full.trim());
  if (m) return { prefix: m[1], stamp: Number(m[2]) };
  const b = full.trim().replace(/\s+/g, "_") || "data_object";
  return { prefix: b, stamp: Date.now() };
}

function sanitizeExportBasename(name: string): string {
  const s = name.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
  return s.slice(0, 100) || "scrubber_output";
}

function buildLiveExportJsonString(lo: {
  output_payload: Record<string, unknown>;
  kpi: Record<string, unknown>;
  health_status: string;
  health_code: string;
  health_message: string;
}): string {
  return JSON.stringify(
    {
      health_status: lo.health_status,
      health_code: lo.health_code,
      health_message: lo.health_message,
      output_payload: lo.output_payload,
      kpi: lo.kpi,
    },
    null,
    2,
  );
}

function buildServerExportJsonString(p: ScrubberPreviewResp["preview"]): string {
  return JSON.stringify(
    {
      object_name: p.object_name,
      health_status: p.health_status,
      health_code: p.health_code,
      health_message: p.health_message,
      output_payload: p.output_payload,
      kpi: p.kpi,
    },
    null,
    2,
  );
}

function downloadTextFile(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadJsonAsPdf(text: string, filename: string): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const maxW = pageW - margin * 2;
  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  const lines = doc.splitTextToSize(text, maxW);
  let y = margin;
  const lineH = 9.5;
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (y + lineH > pageH - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineH;
  }
  doc.save(filename);
}

function ScrubberOutputToolbar(props: {
  exportJson: string;
  fileBasename: string;
  onOpenModal: () => void;
  onCopied?: () => void;
}): ReactNode {
  const { exportJson, fileBasename, onOpenModal, onCopied } = props;
  const base = sanitizeExportBasename(fileBasename);
  return (
    <div className="scrubber-output-toolbar">
      <button
        type="button"
        className="scrubber-btn scrubber-btn--ghost"
        onClick={() => void navigator.clipboard.writeText(exportJson).then(() => onCopied?.())}
      >
        Copy JSON
      </button>
      <button
        type="button"
        className="scrubber-btn scrubber-btn--ghost"
        onClick={() => downloadTextFile(exportJson, `${base}.txt`)}
      >
        Download .txt
      </button>
      <button
        type="button"
        className="scrubber-btn scrubber-btn--ghost"
        onClick={() => downloadJsonAsPdf(exportJson, `${base}.pdf`)}
      >
        Download .pdf
      </button>
      <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={onOpenModal}>
        View JSON
      </button>
    </div>
  );
}

/** Preview always evaluates the current editor draft (does not use publishedBody). */
function mappingForPreview(form: StudioDraftForm, version: string): Record<string, unknown> {
  return {
    scrubberStudio: {
      published: false,
      version,
      draft: formToActiveDraft(form),
    },
  };
}

function scalarCoerce(val: unknown): unknown {
  if (val === null || typeof val === "boolean" || typeof val === "number" || typeof val === "string") return val;
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function mergeFromPayloadTemplate(
  into: Record<string, unknown>,
  template: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  for (const [k, pathVal] of Object.entries(template)) {
    if (typeof pathVal !== "string" || !pathVal.trim()) continue;
    const val = getByPath(payload, pathVal.trim());
    if (val !== undefined) into[k] = val;
  }
}

function applyScalarFieldsToPayload(payload: Record<string, unknown>, fields: unknown): void {
  if (!Array.isArray(fields)) return;
  for (const item of fields) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    if ("literal" in row) {
      payload[name] = scalarCoerce(row.literal);
      continue;
    }
    const fp = row.fromPath;
    if (typeof fp === "string" && fp.trim()) {
      const raw = getByPath(payload, fp.trim());
      payload[name] = scalarCoerce(raw);
    }
  }
}

function mergeHealthOntoPayload(
  payload: Record<string, unknown>,
  display: unknown,
  h: { status: string; code: string; message: string },
): void {
  if (!display || typeof display !== "object" || Array.isArray(display)) return;
  const d = display as Record<string, unknown>;
  if (!d.enabled) return;
  const sk = String(d.statusKey ?? "health_status");
  const ck = String(d.codeKey ?? "health_code");
  const mk = String(d.messageKey ?? "health_message");
  payload[sk] = h.status;
  payload[ck] = h.code;
  payload[mk] = h.message;
}

function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeGpsTimestamp(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = Math.abs(v) > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length >= 13 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function applyGpsMapping(payload: Record<string, unknown>, spec: unknown): void {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return;
  const s = spec as Record<string, unknown>;
  if (!Boolean(s.enabled)) return;

  const out: Record<string, unknown> = {};
  const problems: string[] = [];
  const getPathNum = (k: string): number | null => {
    const p = s[k];
    if (typeof p !== "string" || !p.trim()) return null;
    return coerceFiniteNumber(getByPath(payload, p.trim()));
  };
  const mode = s.sourceMode === "static" ? "static" : "path";
  const lat =
    mode === "static"
      ? coerceFiniteNumber(s.staticLatitude)
      : getPathNum("latitudePath");
  const lon =
    mode === "static"
      ? coerceFiniteNumber(s.staticLongitude)
      : getPathNum("longitudePath");
  const alt = getPathNum("altitudePath");
  const heading = getPathNum("headingPath");
  const speed = getPathNum("speedPath");
  const tsPath = s.timestampPath;
  const ts = typeof tsPath === "string" && tsPath.trim() ? normalizeGpsTimestamp(getByPath(payload, tsPath.trim())) : null;

  if (lat != null) out.lat = lat;
  if (lon != null) out.lon = lon;
  if (alt != null) out.alt = alt;
  if (heading != null) out.heading = heading;
  if (speed != null) out.speed = speed;
  if (ts != null) out.timestamp = ts;

  if (lat == null || lat < -90 || lat > 90) problems.push("latitude invalid (range -90..90)");
  if (lon == null || lon < -180 || lon > 180) problems.push("longitude invalid (range -180..180)");
  out.map_eligible = problems.length === 0;
  if (problems.length) out.validation = problems;
  payload.gps = out;
}

function applyClientTransformExtensions(payload: Record<string, unknown>, active: Record<string, unknown>): Record<string, unknown> {
  let p: Record<string, unknown> = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  const drops = active.dropPaths;
  if (Array.isArray(drops)) {
    for (const d of drops) {
      if (typeof d === "string" && d.trim()) deletePath(p, d.trim());
    }
  }

  const flat = active.flatten;
  if (flat && typeof flat === "object" && !Array.isArray(flat) && Boolean((flat as { enabled?: boolean }).enabled)) {
    const delim =
      typeof (flat as { delimiter?: string }).delimiter === "string" ? (flat as { delimiter: string }).delimiter : "_";
    p = flattenComplete(p, delim);
  }

  const add = active.addAttributes;
  if (add && typeof add === "object" && !Array.isArray(add)) {
    const lit = (add as { literals?: unknown }).literals;
    if (lit && typeof lit === "object" && !Array.isArray(lit)) {
      for (const [k, v] of Object.entries(lit as Record<string, unknown>)) {
        p[k] = JSON.parse(JSON.stringify(v)) as unknown;
      }
    }
    const fp = (add as { fromPayload?: unknown }).fromPayload;
    if (fp && typeof fp === "object" && !Array.isArray(fp)) {
      mergeFromPayloadTemplate(p, fp as Record<string, unknown>, p);
    }
  }

  applyScalarFieldsToPayload(p, active.scalarFields);

  const fb = active.functionBased;
  if (fb && typeof fb === "object" && !Array.isArray(fb) && Boolean((fb as { enabled?: boolean }).enabled)) {
    p._functionBasedPending = "Run Compile preview to apply Python transform(payload) on the server.";
  }
  applyGpsMapping(p, active.gpsMapping);

  return p;
}

/** Mirrors `scrubber_engine` pipeline in the browser (except Python functionBased — placeholder key). */
function computeLiveScrubberOutput(
  form: StudioDraftForm,
  rawRoot: Record<string, unknown> | null,
): {
  output_payload: Record<string, unknown>;
  kpi: Record<string, unknown>;
  health_status: string;
  health_code: string;
  health_message: string;
} | null {
  if (!rawRoot) return null;
  const active = formToActiveDraft(form);
  let payload: Record<string, unknown> = JSON.parse(JSON.stringify(rawRoot)) as Record<string, unknown>;
  const sel = form.selectPath.trim();
  if (sel) {
    const inner = getByPath(payload, sel);
    if (isObjectRecord(inner)) payload = JSON.parse(JSON.stringify(inner)) as Record<string, unknown>;
    else if (inner !== undefined) payload = { value: inner };
    else payload = { _error: "selectPath not found", _path: sel };
  }

  const hasExt = ["dropPaths", "flatten", "addAttributes", "scalarFields", "functionBased", "gpsMapping"].some(
    (k) => active[k] !== undefined && active[k] !== null,
  );
  let working = payload;
  if (hasExt) {
    working = applyClientTransformExtensions(payload, active);
  }

  const kpi = buildKpiOutput(active.kpi, working);
  const health = evaluateHealth(active.health, working);
  let st = health.status.toLowerCase();
  if (st !== "green" && st !== "yellow" && st !== "red") st = "yellow";
  const hFinal = { ...health, status: st };
  mergeHealthOntoPayload(working, active.healthDisplay, hFinal);

  return {
    output_payload: working,
    kpi,
    health_status: hFinal.status,
    health_code: hFinal.code,
    health_message: hFinal.message,
  };
}

export function ScrubberStudioPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const rawId = sp.get("rawId") ?? "";
  const deviceId = sp.get("deviceId") ?? "";
  const returnTo = sp.get("returnTo") ?? "";
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "";

  const [verify, setVerify] = useState<VerifyResp | null>(null);
  const [rawPreview, setRawPreview] = useState<RawPreviewResp | null>(null);
  const rawPreviewCacheRef = useRef<RawPreviewResp | null>(null);
  const [rawPreviewStale, setRawPreviewStale] = useState(false);
  const [ingestionBusy, setIngestionBusy] = useState(false);
  const [latestForDevice, setLatestForDevice] = useState<{ id: string | null; ingestedAt: string | null }>({
    id: null,
    ingestedAt: null,
  });
  const [scrubPreview, setScrubPreview] = useState<ScrubberPreviewResp | null>(null);
  const [form, setForm] = useState<StudioDraftForm>(() => defaultStudioForm());
  const [published, setPublished] = useState(false);
  const [version, setVersion] = useState("1");
  const [activeStep, setActiveStep] = useState<PipelineStepId>("drop");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedJson, setAdvancedJson] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [loadBusy, setLoadBusy] = useState(false);
  const [dropPathDraft, setDropPathDraft] = useState("");
  const [dropEditorMode, setDropEditorMode] = useState<"tabular" | "advanced">("tabular");
  const [stepPickerOpen, setStepPickerOpen] = useState(false);
  const [jsonModal, setJsonModal] = useState<{ title: string; body: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const stepPickerRef = useRef<HTMLDivElement>(null);
  const didStampObjectName = useRef(false);

  const loadLatestIngestion = useCallback(async () => {
    const did = deviceId || verify?.device_id;
    if (!did) {
      setLatestForDevice({ id: null, ingestedAt: null });
      return;
    }
    setIngestionBusy(true);
    try {
      const data = await apiFetch<RawListHeadResp>(
        `/raw-data-objects?device_id=${encodeURIComponent(did)}&limit=1&offset=0`,
      );
      const first = data?.items?.[0];
      setLatestForDevice({
        id: first?.id ?? null,
        ingestedAt: first?.ingested_at ?? null,
      });
    } catch {
      setLatestForDevice({ id: null, ingestedAt: null });
    } finally {
      setIngestionBusy(false);
    }
  }, [deviceId, verify?.device_id]);

  const loadRawPreview = useCallback(async () => {
    if (!rawId) return;
    setErr(null);
    try {
      const p = await apiFetch<RawPreviewResp>(
        `/raw-data-objects/${rawId}/preview?offset=0&max_bytes=${64 * 1024}`,
      );
      setRawPreview(p);
      rawPreviewCacheRef.current = p;
      setRawPreviewStale(false);
      await loadLatestIngestion();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Raw preview failed";
      if (rawPreviewCacheRef.current) {
        setRawPreview(rawPreviewCacheRef.current);
        setRawPreviewStale(true);
        setErr(`${msg} — showing last loaded payload (offline).`);
      } else {
        setRawPreview(null);
        setRawPreviewStale(false);
        setErr(msg);
      }
    }
  }, [rawId, loadLatestIngestion]);

  useEffect(() => {
    rawPreviewCacheRef.current = null;
    setRawPreviewStale(false);
  }, [rawId]);

  useEffect(() => {
    if (!rawId) {
      setVerify(null);
      setRawPreview(null);
      setScrubPreview(null);
      return;
    }
    void (async () => {
      setErr(null);
      try {
        const v = await apiFetch<VerifyResp>(`/raw-data-objects/${rawId}/verify?rehash=false`);
        setVerify(v);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Verify failed");
        setVerify(null);
      }
    })();
  }, [rawId]);

  useEffect(() => {
    void loadRawPreview();
  }, [loadRawPreview]);

  useEffect(() => {
    void loadLatestIngestion();
  }, [loadLatestIngestion]);

  useEffect(() => {
    if (didStampObjectName.current) return;
    didStampObjectName.current = true;
    setForm((f) => {
      if (/^(.+)_(\d{10,})$/.test(f.objectName.trim())) return f;
      const b = f.objectName.trim().replace(/\s+/g, "_") || "data_object";
      return { ...f, objectName: `${b}_${Date.now()}` };
    });
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    void (async () => {
      setLoadBusy(true);
      setErr(null);
      try {
        const row = await apiFetch<{ mapping: Record<string, unknown> } | null>(
          `/device-objects?device_id=${encodeURIComponent(deviceId)}`,
        );
        const ss = row?.mapping?.scrubberStudio;
        if (ss && typeof ss === "object" && !Array.isArray(ss)) {
          const o = ss as Record<string, unknown>;
          setPublished(Boolean(o.published));
          if (typeof o.version === "string" && o.version) setVersion(o.version);
          const draft = o.draft;
          if (draft && typeof draft === "object" && !Array.isArray(draft))
            setForm(activeDraftToForm(draft as Record<string, unknown>));
        }
      } catch {
        /* no device_object yet — keep defaults */
      } finally {
        setLoadBusy(false);
      }
    })();
  }, [deviceId]);

  useEffect(() => {
    if (!stepPickerOpen) return;
    const close = (e: MouseEvent) => {
      if (stepPickerRef.current && !stepPickerRef.current.contains(e.target as Node)) setStepPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [stepPickerOpen]);

  const runScrubberPreview = useCallback(async () => {
    if (!rawId) {
      setErr("rawId required for preview");
      return;
    }
    setPreviewBusy(true);
    setErr(null);
    let mapping: Record<string, unknown>;
    if (showAdvanced) {
      try {
        mapping = JSON.parse(advancedJson) as Record<string, unknown>;
      } catch {
        setErr("Advanced mapping must be valid JSON");
        setPreviewBusy(false);
        return;
      }
    } else {
      mapping = mappingForPreview(form, version);
    }
    try {
      const r = await apiFetch<ScrubberPreviewResp>("/scrubber/preview", {
        method: "POST",
        json: { raw_object_id: rawId, mapping, use_stored_mapping: false },
      });
      setScrubPreview(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scrubber preview failed");
      setScrubPreview(null);
    } finally {
      setPreviewBusy(false);
    }
  }, [rawId, form, version, showAdvanced, advancedJson]);

  async function saveDraft(e?: FormEvent) {
    e?.preventDefault();
    if (!deviceId) {
      setErr("deviceId query param required to save mapping");
      return;
    }
    setErr(null);
    setOk(null);
    let patch: Record<string, unknown>;
    if (showAdvanced) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(advancedJson) as Record<string, unknown>;
      } catch {
        setErr("Advanced mapping must be valid JSON");
        return;
      }
      const ss = parsed.scrubberStudio as Record<string, unknown> | undefined;
      const d = ss?.draft;
      if (!d || typeof d !== "object" || Array.isArray(d)) {
        setErr("Advanced JSON needs mapping.scrubberStudio.draft");
        return;
      }
      patch = {
        scrubberStudio: {
          draft: d,
          ...(typeof ss?.version === "string" && ss.version ? { version: ss.version } : { version }),
        },
      };
    } else {
      patch = { scrubberStudio: { draft: formToActiveDraft(form), version } };
    }
    try {
      await apiFetch(`/device-objects?device_id=${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        json: { mapping: patch },
      });
      setOk("Draft saved on device_object (merged server-side; publish flag unchanged).");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  async function publishMapping(e?: FormEvent) {
    e?.preventDefault();
    if (!deviceId) {
      setErr("deviceId query param required to publish");
      return;
    }
    setErr(null);
    setOk(null);
    let draftObj: Record<string, unknown>;
    let versionForBump = version;
    if (showAdvanced) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(advancedJson) as Record<string, unknown>;
      } catch {
        setErr("Advanced mapping must be valid JSON");
        return;
      }
      const ss = parsed.scrubberStudio as Record<string, unknown> | undefined;
      const d = ss?.draft;
      if (!d || typeof d !== "object" || Array.isArray(d)) {
        setErr("scrubberStudio.draft missing in advanced JSON");
        return;
      }
      draftObj = d as Record<string, unknown>;
      if (typeof ss?.version === "string" && ss.version) versionForBump = ss.version;
    } else {
      draftObj = formToActiveDraft(form);
    }
    const nextV = bumpVersion(versionForBump);
    const publishedBody = JSON.parse(JSON.stringify(draftObj)) as Record<string, unknown>;
    const mapping = {
      scrubberStudio: {
        published: true,
        version: nextV,
        draft: draftObj,
        publishedBody,
      },
    };
    try {
      await apiFetch(`/device-objects?device_id=${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        json: { mapping },
      });
      setVersion(nextV);
      setPublished(true);
      setOk(`Published scrubber v${nextV} (draft copied to publishedBody).`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Publish failed");
    }
  }

  function openAdvanced() {
    const m = {
      scrubberStudio: {
        published,
        version,
        draft: formToActiveDraft(form),
      },
    };
    setAdvancedJson(JSON.stringify(m, null, 2));
    setShowAdvanced(true);
  }

  function applyAdvancedJson() {
    try {
      const m = JSON.parse(advancedJson) as Record<string, unknown>;
      const ss = m.scrubberStudio;
      if (!ss || typeof ss !== "object") throw new Error("Expected mapping.scrubberStudio");
      const o = ss as Record<string, unknown>;
      if (typeof o.version === "string" && o.version) setVersion(o.version);
      setPublished(Boolean(o.published));
      const d = o.draft;
      if (d && typeof d === "object" && !Array.isArray(d)) setForm(activeDraftToForm(d as Record<string, unknown>));
      setShowAdvanced(false);
      setOk("Applied advanced JSON into the studio form.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  const rawFormattedText = useMemo(() => {
    if (!rawPreview || rawPreview.encoding !== "utf8" || rawPreview.text == null) return null;
    try {
      const parsed = JSON.parse(rawPreview.text) as unknown;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return rawPreview.text;
    }
  }, [rawPreview]);

  const rawPanelBody =
    rawPreview == null ? (
      <span style={{ color: "var(--color-text-muted)" }}>{rawId ? "Loading raw…" : "Select a raw object."}</span>
    ) : rawPreview.encoding === "utf8" && rawPreview.text != null ? (
      <pre className="scrubber-pre">{rawFormattedText ?? rawPreview.text}</pre>
    ) : rawPreview.base64 != null ? (
      <pre className="scrubber-pre">
        [binary — base64, {rawPreview.returned_bytes} bytes]
        {"\n"}
        {rawPreview.base64.length > 6000 ? `${rawPreview.base64.slice(0, 6000)}…` : rawPreview.base64}
      </pre>
    ) : (
      <span style={{ color: "var(--color-text-muted)" }}>No preview payload</span>
    );

  const rawParsedObject = (() => {
    if (!rawPreview || rawPreview.encoding !== "utf8" || !rawPreview.text) return null;
    try {
      const parsed = JSON.parse(rawPreview.text) as unknown;
      return isObjectRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })();
  const selectedInputObject = (() => {
    if (!rawParsedObject) return null;
    const selected = form.selectPath.trim() ? getByPath(rawParsedObject, form.selectPath.trim()) : rawParsedObject;
    return isObjectRecord(selected) ? selected : null;
  })();
  const dropCandidatePaths = collectLeafPaths(selectedInputObject ?? {});
  const pathSuggestions = useMemo(() => {
    if (!rawParsedObject) return [] as string[];
    return [...new Set(collectLeafPaths(rawParsedObject))].sort((a, b) => a.localeCompare(b));
  }, [rawParsedObject]);
  const pathSamples = useMemo(() => {
    const o: Record<string, unknown> = {};
    if (!rawParsedObject) return o;
    for (const p of pathSuggestions) {
      o[p] = getByPath(rawParsedObject, p);
    }
    return o;
  }, [rawParsedObject, pathSuggestions]);
  const droppedPaths = form.dropPathsText
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const liveOutput = useMemo(() => computeLiveScrubberOutput(form, rawParsedObject), [form, rawParsedObject]);

  const resultLeafPaths = useMemo(() => {
    if (!liveOutput?.output_payload) return [] as string[];
    return [...new Set(collectLeafPaths(liveOutput.output_payload))].sort((a, b) => a.localeCompare(b));
  }, [liveOutput]);

  const liveExportJson = useMemo(
    () => (liveOutput ? buildLiveExportJsonString(liveOutput) : ""),
    [liveOutput],
  );

  const resultPreview = scrubPreview?.preview;

  const serverExportJson = useMemo(
    () => (resultPreview ? buildServerExportJsonString(resultPreview) : ""),
    [resultPreview],
  );

  const objectNameUi = splitObjectNameUi(form.objectName);

  const goToLatestRawSample = useCallback(() => {
    const did = deviceId || verify?.device_id;
    if (!latestForDevice.id || !did) return;
    const params = new URLSearchParams();
    params.set("rawId", latestForDevice.id);
    params.set("deviceId", did);
    if (safeReturnTo) params.set("returnTo", safeReturnTo);
    navigate(`/scrubber/create?${params.toString()}`, { replace: true });
  }, [latestForDevice.id, deviceId, verify?.device_id, safeReturnTo, navigate]);

  const rawIngestionOnline = useMemo(() => {
    if (!rawId) return false;
    if (rawPreviewStale) return false;
    if (verify?.is_latest_for_device === true) return true;
    if (verify?.is_latest_for_device === false) return false;
    if (!latestForDevice.id) return false;
    return uuidEq(latestForDevice.id, rawId);
  }, [rawId, latestForDevice.id, rawPreviewStale, verify?.is_latest_for_device]);

  useEffect(() => {
    if (!showAdvanced) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAdvanced(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAdvanced]);

  useEffect(() => {
    if (!jsonModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setJsonModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jsonModal]);

  const headerActions = (
    <div className="scrubber-studio__header-actions">
      <label className="scrubber-studio__object-name">
        <span className="scrubber-studio__object-name-label">Object name</span>
        <span className="scrubber-studio__object-name-field">
          <input
            type="text"
            className="scrubber-studio__object-name-input"
            value={objectNameUi.prefix}
            onChange={(e) => {
              const b = e.target.value.trim().replace(/\s+/g, "_") || "data_object";
              setForm((f) => ({ ...f, objectName: `${b}_${objectNameUi.stamp}` }));
            }}
            title={`Stored as ${form.objectName} (used in mapping / device_object)`}
            aria-label="Object name prefix"
          />
          <span className="scrubber-studio__object-name-suffix" title="Unique timestamp suffix">
            _{objectNameUi.stamp}
          </span>
        </span>
      </label>
      <button
        type="button"
        className="scrubber-btn scrubber-btn--primary"
        disabled={previewBusy || !rawId}
        onClick={() => void runScrubberPreview()}
      >
        {previewBusy ? "Compiling preview…" : "Compile preview"}
      </button>
      <button
        type="button"
        className="scrubber-btn scrubber-btn--secondary"
        disabled={!deviceId}
        title="Writes the draft to the device mapping without publishing."
        onClick={saveDraft}
      >
        Save draft
      </button>
      <button
        type="button"
        className="scrubber-btn scrubber-btn--publish"
        disabled={!deviceId}
        title="Publishes this draft version for production pipelines."
        onClick={publishMapping}
      >
        Publish
      </button>
      <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={openAdvanced}>
        Debug JSON…
      </button>
    </div>
  );

  return (
    <>
    <PageShell title="Scrubber Studio" className="scrubber-studio-page" actions={headerActions}>
      {safeReturnTo ? (
        <p style={{ marginTop: 0, marginBottom: "0.5rem" }}>
          <Link to={safeReturnTo}>← Back</Link>
        </p>
      ) : null}
      {!rawId && (
        <PageStatus variant="error" className="page-status--tight-top">
          Pass <code>?rawId=…&amp;deviceId=…</code> (use raw picker). deviceId loads existing mapping.
        </PageStatus>
      )}
      {loadBusy ? <PageStatus variant="success">Loading device mapping…</PageStatus> : null}
      {err ? <PageStatus variant="error">{err}</PageStatus> : null}
      {ok ? <PageStatus variant="success">{ok}</PageStatus> : null}
      {verify && (
        <div style={metaBar}>
          <span>
            Raw <code>{verify.raw_object_id.slice(0, 8)}…</code>
          </span>
          <span
            title={
              rawIngestionOnline
                ? "This archived raw is the newest for the device (verified server-side)."
                : rawPreviewStale
                  ? "Preview failed last refresh; bytes may be stale."
                  : verify?.is_latest_for_device === false
                    ? "A newer raw exists for this device — use “Use latest sample”."
                    : "Not the newest raw for this device, or still loading."
            }
            style={{
              padding: "0.15rem 0.45rem",
              borderRadius: "var(--radius)",
              fontWeight: 600,
              fontSize: "0.78rem",
              background: rawIngestionOnline ? "var(--page-status-success-bg)" : "var(--page-status-warn-bg)",
              color: rawIngestionOnline ? "var(--page-status-success-fg)" : "var(--page-status-warn-fg)",
              border: `1px solid ${rawIngestionOnline ? "var(--page-status-success-border)" : "var(--page-status-warn-border)"}`,
            }}
          >
            {ingestionBusy ? "…" : rawIngestionOnline ? "Online" : "Offline"}
          </span>
          <span>
            Device <code>{verify.device_id.slice(0, 8)}…</code>
          </span>
          <span>
            Draft v<code>{version}</code> · {published ? "published" : "draft-only"}
          </span>
        </div>
      )}

      <div className="scrubber-studio">
        <div className="scrubber-studio__row scrubber-studio__row--top">
          <section className="scrubber-studio__panel scrubber-studio__panel--input">
            <h2 style={colTitle}>Input · raw payload</h2>
            <p style={{ margin: "0 0 0.35rem", fontSize: "0.78rem", color: "var(--color-text-muted)", lineHeight: 1.45 }}>
              {ingestionBusy
                ? "Checking ingestion…"
                : rawIngestionOnline
                  ? "This sample is the latest raw archived for the device."
                  : rawPreviewStale
                    ? "Showing last loaded bytes (offline) — refresh failed."
                    : !latestForDevice.id
                      ? "No archived raw for this device yet (offline)."
                      : "This sample is not the latest raw (offline)."}
            </p>
            <div style={{ flex: 1, minHeight: 0 }}>{rawPanelBody}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                className="scrubber-btn scrubber-btn--secondary"
                onClick={() => void loadRawPreview()}
                disabled={!rawId}
              >
                Refresh raw
              </button>
              <button
                type="button"
                className="scrubber-btn scrubber-btn--secondary"
                onClick={() => void goToLatestRawSample()}
                disabled={
                  !rawId ||
                  !latestForDevice.id ||
                  uuidEq(latestForDevice.id, rawId) ||
                  (!deviceId && !verify?.device_id)
                }
                title="Load the newest raw object for this device (same URL params)."
              >
                Use latest sample
              </button>
            </div>
          </section>

          <section className="scrubber-studio__panel scrubber-studio__panel--editor-wide">
            <div className="scrubber-studio__editor-head" ref={stepPickerRef}>
              <div className="scrubber-studio__editor-head-left">
                <h2 style={{ ...colTitle, margin: 0 }}>Pipeline · editor</h2>
                <button
                  type="button"
                  className={`scrubber-step-chevron${stepPickerOpen ? " scrubber-step-chevron--open" : ""}`}
                  aria-expanded={stepPickerOpen}
                  aria-haspopup="menu"
                  aria-label="Select pipeline step"
                  onClick={() => setStepPickerOpen((o) => !o)}
                >
                  <ChevronDown size={20} strokeWidth={2.25} />
                </button>
                <span className="scrubber-studio__active-step-label">
                  {STEPS.find((x) => x.id === activeStep)?.label ?? activeStep}
                </span>
                {stepPickerOpen ? (
                  <div className="scrubber-step-menu" role="menu">
                    {STEPS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        role="menuitem"
                        className={`scrubber-step-menu__item${s.id === activeStep ? " scrubber-step-menu__item--active" : ""}`}
                        onClick={() => {
                          setActiveStep(s.id);
                          setStepPickerOpen(false);
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="scrubber-studio__editor-head-right">
                <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setHelpOpen(true)}>
                  Help
                </button>
              </div>
            </div>
            <p style={colHint}>{STEPS.find((x) => x.id === activeStep)?.hint}</p>
            <datalist id={PATH_HINTS_DATALIST_ID}>
              {pathSuggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <div className="scrubber-studio__editor-scroll">
              {renderStepEditor(activeStep, form, setForm, {
                droppedPaths,
                dropCandidatePaths,
                dropPathDraft,
                setDropPathDraft,
                pathSuggestions,
                pathSamples,
                dropEditorMode,
                setDropEditorMode,
                resultLeafPaths,
                liveGps: isObjectRecord(liveOutput?.output_payload?.gps) ? (liveOutput?.output_payload?.gps as Record<string, unknown>) : null,
              })}
            </div>
          </section>
        </div>

        <div className="scrubber-studio__row scrubber-studio__row--result">
          <section className="scrubber-studio__panel">
            <h2 style={colTitle}>Result · transformed object</h2>
            <p style={colHint}>
              Live output tracks the pipeline as you edit. <strong>Compile preview</strong> runs function-based Python on
              the server — see compiled block below when available.
            </p>
            {!rawParsedObject ? (
              <span style={{ color: "var(--color-text-muted)" }}>
                Load a JSON raw preview to see live transformed output.
              </span>
            ) : liveOutput && liveExportJson ? (
              <>
                <div style={healthBannerStyle(liveOutput.health_status)}>
                  <strong>Health</strong> (live): {liveOutput.health_status} · <code>{liveOutput.health_code}</code>
                  <div style={{ fontSize: "0.82rem", marginTop: "0.25rem" }}>{liveOutput.health_message}</div>
                </div>
                <ScrubberOutputToolbar
                  exportJson={liveExportJson}
                  fileBasename={form.objectName}
                  onOpenModal={() =>
                    setJsonModal({ title: "Live output (JSON)", body: liveExportJson })
                  }
                  onCopied={() => setOk("Copied JSON to clipboard.")}
                />
                <div style={miniHead}>Output payload (live)</div>
                <pre className="scrubber-pre scrubber-pre--compact">{safeJsonPreview(liveOutput.output_payload, 32000)}</pre>
                <div style={miniHead}>KPI (kpi_json) — live</div>
                <pre className="scrubber-pre scrubber-pre--compact">{safeJsonPreview(liveOutput.kpi, 12000)}</pre>
              </>
            ) : null}
            {resultPreview && serverExportJson ? (
              <details style={{ marginTop: "0.65rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "var(--color-text-muted)" }}>
                  Server compiled preview (last Compile)
                </summary>
                <div style={{ marginTop: "0.5rem" }}>
                  <div style={healthBannerStyle(resultPreview.health_status)}>
                    <strong>Health</strong>: {resultPreview.health_status} · <code>{resultPreview.health_code}</code>
                    <div style={{ fontSize: "0.82rem", marginTop: "0.25rem" }}>{resultPreview.health_message}</div>
                  </div>
                  <ScrubberOutputToolbar
                    exportJson={serverExportJson}
                    fileBasename={`${form.objectName}_compiled`}
                    onOpenModal={() =>
                      setJsonModal({ title: "Server compiled output (JSON)", body: serverExportJson })
                    }
                    onCopied={() => setOk("Copied compiled JSON to clipboard.")}
                  />
                  <div style={miniHead}>Output payload</div>
                  <pre className="scrubber-pre scrubber-pre--compact">{safeJsonPreview(resultPreview.output_payload, 32000)}</pre>
                  <div style={miniHead}>KPI (kpi_json)</div>
                  <pre className="scrubber-pre scrubber-pre--compact">{safeJsonPreview(resultPreview.kpi, 12000)}</pre>
                </div>
              </details>
            ) : null}
            {scrubPreview?.error ? <PageStatus variant="error">{scrubPreview.error}</PageStatus> : null}
          </section>
        </div>
      </div>
    </PageShell>

    {showAdvanced ? (
      <div className="scrubber-debug-modal-backdrop" role="presentation" onClick={() => setShowAdvanced(false)}>
        <div
          className="scrubber-debug-modal"
          role="dialog"
          aria-modal
          aria-labelledby="scrubber-debug-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="scrubber-debug-modal__head">
            <h2 id="scrubber-debug-modal-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
              Debug · mapping JSON
            </h2>
            <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setShowAdvanced(false)}>
              Close
            </button>
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", margin: "0 0 0.5rem" }}>
            Edit <code>scrubberStudio</code> JSON. <strong>Apply JSON → form</strong> merges into the guided pipeline.
            Save/Publish/Compile still use this JSON while the modal is open.
          </p>
          <textarea
            value={advancedJson}
            onChange={(e) => setAdvancedJson(e.target.value)}
            className="scrubber-freeflow-textarea scrubber-debug-modal__textarea"
            spellCheck={false}
          />
          <div className="scrubber-debug-modal__actions">
            <button type="button" className="scrubber-btn scrubber-btn--primary" onClick={applyAdvancedJson}>
              Apply JSON → form
            </button>
            <button type="button" className="scrubber-btn scrubber-btn--secondary" onClick={() => setShowAdvanced(false)}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    ) : null}

    <ScrubberPipelineHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} initialStepId={activeStep} />

    {jsonModal ? (
      <div className="scrubber-debug-modal-backdrop" role="presentation" onClick={() => setJsonModal(null)}>
        <div
          className="scrubber-output-json-modal"
          role="dialog"
          aria-modal
          aria-labelledby="scrubber-json-view-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="scrubber-debug-modal__head">
            <h2 id="scrubber-json-view-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
              {jsonModal.title}
            </h2>
            <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setJsonModal(null)}>
              Close
            </button>
          </div>
          <pre className="scrubber-output-json-modal__body">{jsonModal.body}</pre>
        </div>
      </div>
    ) : null}
    </>
  );
}

function renderStepEditor(
  step: PipelineStepId,
  form: StudioDraftForm,
  setForm: Dispatch<SetStateAction<StudioDraftForm>>,
  ui: {
    droppedPaths: string[];
    dropCandidatePaths: string[];
    dropPathDraft: string;
    setDropPathDraft: Dispatch<SetStateAction<string>>;
    pathSuggestions: string[];
    pathSamples: Record<string, unknown>;
    dropEditorMode: "tabular" | "advanced";
    setDropEditorMode: Dispatch<SetStateAction<"tabular" | "advanced">>;
    resultLeafPaths: string[];
    liveGps: Record<string, unknown> | null;
  },
): ReactNode {
  if (step === "drop") {
    return (
      <>
        <div style={{ ...pairRow, marginBottom: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, marginRight: "0.35rem" }}>Editor</span>
          <button
            type="button"
            className={`scrubber-btn${ui.dropEditorMode === "tabular" ? " scrubber-btn--secondary" : " scrubber-btn--ghost"}`}
            onClick={() => ui.setDropEditorMode("tabular")}
          >
            Tabular
          </button>
          <button
            type="button"
            className={`scrubber-btn${ui.dropEditorMode === "advanced" ? " scrubber-btn--secondary" : " scrubber-btn--ghost"}`}
            onClick={() => ui.setDropEditorMode("advanced")}
          >
            Advanced freeform
          </button>
          <label
            className="scrubber-studio__flatten-inline"
            style={{ marginLeft: "0.25rem" }}
            title="Recursively merge nested objects into dotted keys (delimiter _ in mapping JSON)."
          >
            <input
              type="checkbox"
              checked={form.flattenEnabled}
              onChange={(e) => setForm((f) => ({ ...f, flattenEnabled: e.target.checked }))}
            />
            Flatten
          </label>
        </div>
        {ui.dropEditorMode === "tabular" ? (
          <>
            <div style={subhead}>Dropped fields</div>
            <div style={{ fontSize: "0.76rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>
              Paths come from the loaded JSON (leaves and array keys). Check <strong>Drop</strong> to remove a path; one path per line is kept in sync with freeform mode.
            </div>
            {ui.dropCandidatePaths.length > 0 ? (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", maxHeight: "220px", overflow: "auto" }}>
                <table style={{ ...tblMini, width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={thMini}>Attribute path</th>
                      <th style={thMini}>Keep</th>
                      <th style={thMini}>Drop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ui.dropCandidatePaths.map((p) => {
                      const isDropped = ui.droppedPaths.includes(p);
                      return (
                        <tr key={p}>
                          <td style={tdMini}>
                            <code>{p}</code>
                          </td>
                          <td style={tdMini}>
                            <input
                              type="checkbox"
                              checked={!isDropped}
                              onChange={() => {
                                const set = new Set(ui.droppedPaths);
                                set.delete(p);
                                setForm((f) => ({ ...f, dropPathsText: Array.from(set).join("\n") }));
                              }}
                            />
                          </td>
                          <td style={tdMini}>
                            <input
                              type="checkbox"
                              checked={isDropped}
                              onChange={() => {
                                const set = new Set(ui.droppedPaths);
                                set.add(p);
                                setForm((f) => ({ ...f, dropPathsText: Array.from(set).join("\n") }));
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                Load a JSON raw preview to list paths, or switch to Advanced freeform to type paths manually.
              </div>
            )}
          </>
        ) : (
          <>
            <div style={subhead}>Drop paths (freeform)</div>
            <div style={{ fontSize: "0.76rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>
              One dotted path per line (e.g. <code>readings.temp_c</code>). Optional: pick a hint then edit. Arrays are listed by property path only.
            </div>
            <div style={pairRow}>
              <input
                style={{ ...inp, flex: "1 1 auto" }}
                list={PATH_HINTS_DATALIST_ID}
                placeholder="Type or pick a path, then Add"
                value={ui.dropPathDraft}
                onChange={(e) => ui.setDropPathDraft(e.target.value)}
              />
              <button
                type="button"
                className="scrubber-btn scrubber-btn--ghost"
                onClick={() => {
                  const next = ui.dropPathDraft.trim();
                  if (!next) return;
                  const set = new Set(ui.droppedPaths);
                  set.add(next);
                  setForm((f) => ({ ...f, dropPathsText: Array.from(set).join("\n") }));
                  ui.setDropPathDraft("");
                }}
              >
                Add to drop list
              </button>
            </div>
            <label style={{ ...lbl, marginTop: "0.35rem" }}>
              Paths to remove (newline-separated)
              <textarea
                style={{ ...inp, minHeight: "120px", marginTop: "0.25rem", fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}
                value={form.dropPathsText}
                onChange={(e) => setForm((f) => ({ ...f, dropPathsText: e.target.value }))}
                spellCheck={false}
              />
            </label>
          </>
        )}
      </>
    );
  }
  if (step === "addAttributes") {
    return (
      <>
        <div style={subhead}>Literal attributes</div>
        <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>
          Example: Key <code>site</code>, Value <code>"Factory-A"</code>
        </div>
        {form.attrLiterals.map((row, i) => (
          <div key={i} style={pairRow}>
            <input
              style={inp}
              placeholder="key"
              value={row.key}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => {
                  const next = [...f.attrLiterals];
                  next[i] = { ...next[i], key: v };
                  return { ...f, attrLiterals: next };
                });
              }}
            />
            <input
              style={inp}
              placeholder='value (JSON ok, e.g. "x" or 1)'
              value={row.value}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => {
                  const next = [...f.attrLiterals];
                  next[i] = { ...next[i], value: v };
                  return { ...f, attrLiterals: next };
                });
              }}
            />
            <button
              type="button"
              className="scrubber-btn scrubber-btn--ghost"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  attrLiterals: f.attrLiterals.filter((_, j) => j !== i) || [{ key: "", value: "" }],
                }))
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setForm((f) => ({ ...f, attrLiterals: [...f.attrLiterals, { key: "", value: "" }] }))}>
          Add literal row
        </button>
        <div style={{ ...subhead, marginTop: "0.75rem" }}>Copy from payload (key → dotted path)</div>
        <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>
          Example: <code>temperature_c</code> → <code>sensor.temp</code>
        </div>
        {form.attrFromPayload.map((row, i) => (
          <div key={i} style={pairRow}>
            <input
              style={inp}
              placeholder="attr name"
              value={row.key}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => {
                  const next = [...f.attrFromPayload];
                  next[i] = { ...next[i], key: v };
                  return { ...f, attrFromPayload: next };
                });
              }}
            />
            <input
              style={inp}
              placeholder="fromPath"
              value={row.path}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => {
                  const next = [...f.attrFromPayload];
                  next[i] = { ...next[i], path: v };
                  return { ...f, attrFromPayload: next };
                });
              }}
            />
            <button
              type="button"
              className="scrubber-btn scrubber-btn--ghost"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  attrFromPayload: f.attrFromPayload.filter((_, j) => j !== i) || [{ key: "", path: "" }],
                }))
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setForm((f) => ({ ...f, attrFromPayload: [...f.attrFromPayload, { key: "", path: "" }] }))}>
          Add mapping row
        </button>
      </>
    );
  }
  if (step === "scalars") {
    return (
      <>
        {form.scalarRows.map((row, i) => (
          <div key={i} style={{ ...pairRow, flexWrap: "wrap" }}>
            <input
              style={inp}
              placeholder="field name"
              value={row.name}
              onChange={(e) => {
                const v = e.target.value;
                setForm((f) => {
                  const next = [...f.scalarRows];
                  next[i] = { ...next[i], name: v };
                  return { ...f, scalarRows: next };
                });
              }}
            />
            <select
              style={inp}
              value={row.mode}
              onChange={(e) => {
                const v = e.target.value as "path" | "literal";
                setForm((f) => {
                  const next = [...f.scalarRows];
                  next[i] = { ...next[i], mode: v };
                  return { ...f, scalarRows: next };
                });
              }}
            >
              <option value="path">fromPath</option>
              <option value="literal">literal</option>
            </select>
            {row.mode === "path" ? (
              <input
                style={{ ...inp, flex: "1 1 160px" }}
                placeholder="dotted.path"
                value={row.path}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => {
                    const next = [...f.scalarRows];
                    next[i] = { ...next[i], path: v };
                    return { ...f, scalarRows: next };
                  });
                }}
              />
            ) : (
              <input
                style={{ ...inp, flex: "1 1 160px" }}
                placeholder="literal (JSON)"
                value={row.literal}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => {
                    const next = [...f.scalarRows];
                    next[i] = { ...next[i], literal: v };
                    return { ...f, scalarRows: next };
                  });
                }}
              />
            )}
            <button
              type="button"
              className="scrubber-btn scrubber-btn--ghost"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  scalarRows: f.scalarRows.filter((_, j) => j !== i) || [{ name: "", mode: "path", path: "", literal: "" }],
                }))
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setForm((f) => ({ ...f, scalarRows: [...f.scalarRows, { name: "", mode: "path", path: "", literal: "" }] }))}>
          Add scalar field
        </button>
      </>
    );
  }
  if (step === "health") {
    return (
      <HealthStepEditor
        form={form}
        setForm={(up) =>
          setForm((prev) => {
            const next = typeof up === "function" ? up(prev) : up;
            return { ...next, healthRawLegacy: null };
          })
        }
        datalistId={PATH_HINTS_DATALIST_ID}
      />
    );
  }
  if (step === "gps") {
    const gps = ui.liveGps;
    const eligible = gps?.map_eligible === true;
    const problems = Array.isArray(gps?.validation) ? gps.validation.map((x) => String(x)) : [];
    const gpsFieldOptions = ui.pathSuggestions.filter((p) => {
      const sample = ui.pathSamples[p];
      if (sample == null) return true;
      if (typeof sample === "number") return true;
      if (typeof sample === "string") return !Number.isNaN(Number(sample.trim()));
      return false;
    });
    return (
      <>
        <label style={rowChk}>
          <input
            type="checkbox"
            checked={form.gpsEnabled}
            onChange={(e) => setForm((f) => ({ ...f, gpsEnabled: e.target.checked }))}
          />{" "}
          Enable GPS normalization
        </label>
        <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 0 }}>
          Maps transformed payload paths into <code>gps.lat</code>/<code>gps.lon</code> (+ optional altitude, heading, speed, timestamp).
          Timestamp is normalized to UTC ISO-8601.
        </p>
        <label style={lbl}>
          Coordinate mode
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <label style={rowChk}>
              <input
                type="radio"
                checked={form.gpsSourceMode === "path"}
                onChange={() => setForm((f) => ({ ...f, gpsSourceMode: "path" }))}
              />
              Pick latitude/longitude attributes
            </label>
            <label style={rowChk}>
              <input
                type="radio"
                checked={form.gpsSourceMode === "static"}
                onChange={() => setForm((f) => ({ ...f, gpsSourceMode: "static" }))}
              />
              Static latitude/longitude
            </label>
          </div>
        </label>
        {form.gpsSourceMode === "path" ? (
          <>
            <label style={lbl}>
              Latitude path (required)
              <select
                style={inp}
                value={form.gpsLatitudePath}
                onChange={(e) => setForm((f) => ({ ...f, gpsLatitudePath: e.target.value }))}
              >
                <option value="">Select latitude attribute</option>
                {gpsFieldOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label style={lbl}>
              Longitude path (required)
              <select
                style={inp}
                value={form.gpsLongitudePath}
                onChange={(e) => setForm((f) => ({ ...f, gpsLongitudePath: e.target.value }))}
              >
                <option value="">Select longitude attribute</option>
                {gpsFieldOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <div style={{ ...pairRow, flexWrap: "wrap", alignItems: "flex-start" }}>
            <label style={{ ...lbl, flex: "1 1 180px" }}>
              Static latitude
              <input
                style={inp}
                type="number"
                step="any"
                value={form.gpsStaticLatitude}
                onChange={(e) => setForm((f) => ({ ...f, gpsStaticLatitude: e.target.value }))}
                placeholder="e.g. 12.9716"
              />
            </label>
            <label style={{ ...lbl, flex: "1 1 180px" }}>
              Static longitude
              <input
                style={inp}
                type="number"
                step="any"
                value={form.gpsStaticLongitude}
                onChange={(e) => setForm((f) => ({ ...f, gpsStaticLongitude: e.target.value }))}
                placeholder="e.g. 77.5946"
              />
            </label>
          </div>
        )}
        <div style={{ ...pairRow, flexWrap: "wrap", alignItems: "flex-start" }}>
          <label style={{ ...lbl, flex: "1 1 180px" }}>
            Altitude path (optional)
            <input
              style={inp}
              list={PATH_HINTS_DATALIST_ID}
              value={form.gpsAltitudePath}
              onChange={(e) => setForm((f) => ({ ...f, gpsAltitudePath: e.target.value }))}
            />
          </label>
          <label style={{ ...lbl, flex: "1 1 180px" }}>
            Heading path (optional)
            <input
              style={inp}
              list={PATH_HINTS_DATALIST_ID}
              value={form.gpsHeadingPath}
              onChange={(e) => setForm((f) => ({ ...f, gpsHeadingPath: e.target.value }))}
            />
          </label>
        </div>
        <div style={{ ...pairRow, flexWrap: "wrap", alignItems: "flex-start" }}>
          <label style={{ ...lbl, flex: "1 1 180px" }}>
            Speed path (optional)
            <input
              style={inp}
              list={PATH_HINTS_DATALIST_ID}
              value={form.gpsSpeedPath}
              onChange={(e) => setForm((f) => ({ ...f, gpsSpeedPath: e.target.value }))}
            />
          </label>
          <label style={{ ...lbl, flex: "1 1 180px" }}>
            Timestamp path (optional)
            <input
              style={inp}
              list={PATH_HINTS_DATALIST_ID}
              value={form.gpsTimestampPath}
              onChange={(e) => setForm((f) => ({ ...f, gpsTimestampPath: e.target.value }))}
              placeholder="epoch or iso string"
            />
          </label>
        </div>
        <div style={{ marginTop: "0.5rem", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "0.45rem" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.25rem" }}>Validation preview</div>
          {gps ? (
            <>
              <div style={{ fontSize: "0.76rem", color: eligible ? "var(--page-status-success-fg)" : "var(--page-status-warn-fg)" }}>
                {eligible ? "Map eligible (valid lat/lon)." : "Not map eligible yet."}
              </div>
              <pre className="scrubber-pre scrubber-pre--compact" style={{ marginTop: "0.35rem", maxHeight: "130px" }}>
                {safeJsonPreview(gps, 2400)}
              </pre>
              {problems.length > 0 ? (
                <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1rem", fontSize: "0.74rem", color: "var(--page-status-warn-fg)" }}>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div style={{ fontSize: "0.76rem", color: "var(--color-text-muted)" }}>
              Compile or live preview payload to inspect normalized <code>gps</code>.
            </div>
          )}
        </div>
      </>
    );
  }

  if (step === "functionBased") {
    return (
      <>
        <label style={rowChk}>
          <input
            type="checkbox"
            checked={form.functionBasedEnabled}
            onChange={(e) => setForm((f) => ({ ...f, functionBasedEnabled: e.target.checked }))}
          />{" "}
          Enable Function Based step
        </label>
        <div style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
          Define <code>transform(payload)</code> and return a dict of scalar top-level fields only. Imports are blocked.
          Helpers available: string (`lower`, `upper`, `strip`, `replace`, `split`, `join`), date (`now_iso`,
          `parse_iso`, `to_epoch`, `format_date`), math/stat (`abs`, `round`, `min`, `max`, `sum`, `pow`, `sqrt`,
          `log`, `mean`, `median`, `stdev`).
        </div>
        <label style={miniLbl}>
          Timeout (ms)
          <input
            type="number"
            min={50}
            max={2000}
            style={inp}
            value={form.functionBasedTimeoutMs}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                functionBasedTimeoutMs: Math.max(50, Math.min(2000, Number(e.target.value || 200))),
              }))
            }
          />
        </label>
        <label style={lbl}>
          Python code
          <textarea
            rows={12}
            style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: "0.78rem" }}
            value={form.functionBasedCode}
            onChange={(e) => setForm((f) => ({ ...f, functionBasedCode: e.target.value }))}
          />
        </label>
      </>
    );
  }
  if (step === "kpi") {
    return (
      <KpiStepEditor
        form={form}
        setForm={setForm}
        pathSuggestions={ui.pathSuggestions}
        pathSamples={ui.pathSamples}
        datalistId={PATH_HINTS_DATALIST_ID}
      />
    );
  }

  return null;
}

function healthBannerStyle(status: string): CSSProperties {
  return {
    padding: "0.5rem",
    borderRadius: "var(--radius)",
    border: `1px solid ${healthColor(status)}`,
    marginBottom: "0.5rem",
    fontSize: "0.88rem",
  };
}

const colTitle: CSSProperties = { fontSize: "1rem", margin: 0, fontWeight: 700 };
const colHint: CSSProperties = { fontSize: "0.78rem", color: "var(--color-text-muted)", margin: 0 };

const metaBar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "1rem",
  fontSize: "0.82rem",
  marginBottom: "0.5rem",
  padding: "0.45rem 0.6rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
};

const lbl: CSSProperties = {
  display: "grid",
  gap: "0.35rem",
  fontSize: "0.82rem",
  color: "var(--color-text-muted)",
};
const miniLbl: CSSProperties = { display: "grid", gap: "0.2rem", fontSize: "0.78rem", color: "var(--color-text-muted)" };
const inp: CSSProperties = {
  padding: "0.45rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
};
const rowChk: CSSProperties = { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" };
const pairRow: CSSProperties = { display: "flex", gap: "0.35rem", alignItems: "center", marginBottom: "0.35rem" };
const subhead: CSSProperties = { fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.25rem" };
const miniHead: CSSProperties = { fontSize: "0.78rem", fontWeight: 600, marginTop: "0.5rem" };

const tblMini: CSSProperties = { borderCollapse: "collapse", fontSize: "0.76rem" };
const thMini: CSSProperties = {
  textAlign: "left",
  padding: "0.3rem 0.35rem",
  borderBottom: "1px solid var(--color-border)",
  position: "sticky",
  top: 0,
  background: "var(--color-bg)",
};
const tdMini: CSSProperties = {
  padding: "0.3rem 0.35rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};
