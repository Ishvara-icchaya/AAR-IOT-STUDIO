import { useState } from "react";
import type { Scrubber2FieldMeta } from "@/lib/scrubber2Fields";
import {
  buildFieldMetaList,
  getByPath,
  scrubberPreviewPayloadForFieldPickers,
} from "@/lib/scrubber2Fields";
import type { DecodeSeriesSuggestion } from "@/lib/scrubber2DecodeSeriesFromField";
import { suggestDecodeSeriesForField } from "@/lib/scrubber2DecodeSeriesFromField";
import { Scrubber2FieldPicker } from "./Scrubber2FieldPicker";
import { DecodeSeriesConfigModal } from "@/pages/scrubber2/DecodeSeriesConfigModal";
import { SCRUBBER2_SEMANTIC_ROLES, type Scrubber2Model } from "@/types/scrubber2Model";
import { apiFetch } from "@/api/client";
import { buildScrubberStudioMappingForPreview } from "@/lib/scrubber2ToStudioDraft";

type DerivedHelpTabId = "math" | "stat" | "string" | "date" | "loop" | "example";

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

/** Human-readable default label from a dotted path (e.g. `gps.hdop` → `Hdop`). */
function defaultAttributeLabelFromPath(path: string): string {
  const t = path.trim();
  if (!t) return "";
  const leaf = t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t;
  const spaced = leaf.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  if (!spaced) return t;
  if (spaced.length === 1) return spaced.toUpperCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Same path list as Semantics pickers after Validate — always derived from preview JSON, not early pipeline. */
function semanticsFieldsFromPreviewPayload(pathSamplePreview: Record<string, unknown> | null): Scrubber2FieldMeta[] {
  if (!pathSamplePreview) return [];
  return buildFieldMetaList(scrubberPreviewPayloadForFieldPickers(pathSamplePreview));
}

/** Field list for Default Attributes: preview-derived paths first, then API pickers, then early pipeline. */
function resolveSemanticsDefaultSourceFields(
  pathSamplePreview: Record<string, unknown> | null,
  fieldsFromPreview: Scrubber2FieldMeta[] | null,
  fieldsEarlyPipeline: Scrubber2FieldMeta[],
): Scrubber2FieldMeta[] {
  const fromPayload = semanticsFieldsFromPreviewPayload(pathSamplePreview);
  if (fromPayload.length > 0) return fromPayload;
  if (fieldsFromPreview && fieldsFromPreview.length > 0) return fieldsFromPreview;
  return fieldsEarlyPipeline;
}

/** Merge/replace `fieldSemantics` from a resolved field-meta list (explicit handler for the Default Attributes control). */
function applyDefaultFieldSemanticsFromSource(
  setModel: (fn: (m: Scrubber2Model) => Scrubber2Model) => void,
  sourceFields: Scrubber2FieldMeta[],
): void {
  if (sourceFields.length === 0) return;
  setModel((m) => {
    const byPath = new Map(m.fieldSemantics.map((s) => [s.path, s]));
    const next = sourceFields.map((f) => {
      const prev = byPath.get(f.path);
      const inferredLabel = (f.label && f.label.trim()) || defaultAttributeLabelFromPath(f.path);
      if (prev) {
        const keepLabel = (prev.label ?? "").trim();
        return {
          path: f.path,
          type: f.type,
          roles: Array.isArray(prev.roles) ? [...prev.roles] : [],
          label: keepLabel || inferredLabel,
          ...(prev.aiExposed !== undefined ? { aiExposed: prev.aiExposed } : {}),
        };
      }
      return {
        path: f.path,
        type: f.type,
        roles: [],
        label: inferredLabel,
      };
    });
    const sourcePaths = new Set(sourceFields.map((x) => x.path));
    const extras = m.fieldSemantics.filter((s) => s.path.trim() && !sourcePaths.has(s.path));
    return { ...m, fieldSemantics: [...next, ...extras] };
  });
}

type Props = {
  stepIndex: number;
  model: Scrubber2Model;
  setModel: (fn: (m: Scrubber2Model) => Scrubber2Model) => void;
  fieldsEarlyPipeline: Scrubber2FieldMeta[];
  fieldsFromPreview: Scrubber2FieldMeta[] | null;
  pathSampleEarly: Record<string, unknown> | null;
  pathSamplePreview: Record<string, unknown> | null;
  samplePayload: Record<string, unknown> | null;
  rawId: string | null;
  onRequestPreview: () => void;
};

export function Scrubber2StepContent({
  stepIndex,
  model,
  setModel,
  fieldsEarlyPipeline,
  fieldsFromPreview,
  pathSampleEarly,
  pathSamplePreview,
  samplePayload,
  rawId,
  onRequestPreview,
}: Props) {
  const [derivedHelpTab, setDerivedHelpTab] = useState<DerivedHelpTabId>("math");
  const [decodeSeriesModal, setDecodeSeriesModal] = useState<{
    sourcePath: string;
    suggestion: DecodeSeriesSuggestion;
  } | null>(null);

  const pickerFields =
    stepIndex >= 4 ? (fieldsFromPreview ?? fieldsEarlyPipeline) : fieldsEarlyPipeline;
  const pathSampleRoot =
    (pathSamplePreview ?? pathSampleEarly ?? samplePayload ?? null) as Record<string, unknown> | null;

  if (stepIndex === 0) {
    return (
      <>
        <p>Select which fields to include in the transformed payload using the checkboxes in the left explorer.</p>
        <p className="scrubber2-muted">No raw JSON editing here — use Raw input on the left.</p>
      </>
    );
  }

  if (stepIndex === 1) {
    const before = samplePayload ? JSON.stringify(samplePayload, null, 2) : "—";
    let after = before;
    if (samplePayload && model.normalize.flatten) {
      let p: Record<string, unknown> = JSON.parse(JSON.stringify(samplePayload)) as Record<string, unknown>;
      p = flattenOneLevel(p, "_");
      after = JSON.stringify(p, null, 2);
    }
    const renameRows = model.normalize.renames;
    return (
      <>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.82rem" }}>
          <input
            type="checkbox"
            checked={model.normalize.flatten}
            onChange={(e) =>
              setModel((m) => ({ ...m, normalize: { ...m.normalize, flatten: e.target.checked } }))
            }
          />
          Flatten nested objects (one level per pass at runtime)
        </label>
        <div className="scrubber2-muted" style={{ fontSize: "0.75rem" }}>
          Renames become scalar copy steps in the legacy engine (output field name ← source path).
        </div>
        <div className="scrubber2-toolbar">
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            onClick={() =>
              setModel((m) => ({
                ...m,
                normalize: { ...m.normalize, renames: [...m.normalize.renames, { from: "", to: "" }] },
              }))
            }
          >
            Add rename
          </button>
        </div>
        <div className="scrubber2-table-scroll">
          <table className="scrubber2-table">
            <thead>
              <tr>
                <th>Source path</th>
                <th>Output field name</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {renameRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="scrubber2-muted">
                    No renames yet.
                  </td>
                </tr>
              ) : (
                renameRows.map((pair, idx) => (
                  <tr key={idx}>
                    <td>
                      <Scrubber2FieldPicker
                        fields={pickerFields}
                        value={pair.from}
                        onChange={(p) =>
                          setModel((m) => {
                            const renames = [...m.normalize.renames];
                            renames[idx] = { ...renames[idx], from: p };
                            return { ...m, normalize: { ...m.normalize, renames } };
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="scrubber2-input"
                        value={pair.to}
                        onChange={(e) =>
                          setModel((m) => {
                            const renames = [...m.normalize.renames];
                            renames[idx] = { ...renames[idx], to: e.target.value };
                            return { ...m, normalize: { ...m.normalize, renames } };
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="scrubber2-btn scrubber2-btn--ghost"
                        onClick={() =>
                          setModel((m) => ({
                            ...m,
                            normalize: {
                              ...m.normalize,
                              renames: m.normalize.renames.filter((_, j) => j !== idx),
                            },
                          }))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="scrubber2-muted">Before / after (flatten only in this mock)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", minHeight: 0 }}>
          <div className="scrubber2-code-scroll" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8 }}>
            <pre>{before}</pre>
          </div>
          <div className="scrubber2-code-scroll" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8 }}>
            <pre>{after}</pre>
          </div>
        </div>
      </>
    );
  }

  if (stepIndex === 2) {
    return (
      <>
        <div className="scrubber2-toolbar">
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            onClick={() =>
              setModel((m) => ({
                ...m,
                attributes: [...m.attributes, { key: "", mode: "literal", value: "" }],
              }))
            }
          >
            Add row
          </button>
        </div>
        <div className="scrubber2-table-scroll">
          <table className="scrubber2-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Mode</th>
                <th>Value / source</th>
                <th>Type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.attributes.map((row, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="scrubber2-input"
                      value={row.key}
                      onChange={(e) =>
                        setModel((m) => {
                          const attrs = [...m.attributes];
                          attrs[i] = { ...attrs[i], key: e.target.value };
                          return { ...m, attributes: attrs };
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="scrubber2-input"
                      value={row.mode}
                      onChange={(e) =>
                        setModel((m) => {
                          const attrs = [...m.attributes];
                          attrs[i] = { ...attrs[i], mode: e.target.value as "literal" | "copy" };
                          return { ...m, attributes: attrs };
                        })
                      }
                    >
                      <option value="literal">Literal</option>
                      <option value="copy">Copy from payload</option>
                    </select>
                  </td>
                  <td>
                    {row.mode === "copy" ? (
                      <Scrubber2FieldPicker
                        fields={pickerFields}
                        value={row.sourcePath ?? ""}
                        onChange={(p) =>
                          setModel((m) => {
                            const attrs = [...m.attributes];
                            attrs[i] = { ...attrs[i], sourcePath: p };
                            return { ...m, attributes: attrs };
                          })
                        }
                      />
                    ) : (
                      <input
                        className="scrubber2-input"
                        value={row.value === undefined ? "" : String(row.value)}
                        onChange={(e) =>
                          setModel((m) => {
                            const attrs = [...m.attributes];
                            attrs[i] = { ...attrs[i], value: e.target.value };
                            return { ...m, attributes: attrs };
                          })
                        }
                      />
                    )}
                  </td>
                  <td>
                    <input
                      className="scrubber2-input"
                      placeholder="optional"
                      value={row.type ?? ""}
                      onChange={(e) =>
                        setModel((m) => {
                          const attrs = [...m.attributes];
                          attrs[i] = { ...attrs[i], type: e.target.value };
                          return { ...m, attributes: attrs };
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="scrubber2-btn scrubber2-btn--ghost"
                      onClick={() =>
                        setModel((m) => ({
                          ...m,
                          attributes: m.attributes.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (stepIndex === 3) {
    const tabBtn = (id: DerivedHelpTabId, label: string) => (
      <button
        key={id}
        type="button"
        className="scrubber2-btn scrubber2-btn--ghost"
        onClick={() => setDerivedHelpTab(id)}
        aria-selected={derivedHelpTab === id}
        style={{
          fontSize: "0.72rem",
          padding: "0.2rem 0.5rem",
          fontWeight: derivedHelpTab === id ? 600 : 400,
          opacity: derivedHelpTab === id ? 1 : 0.75,
          borderBottom: derivedHelpTab === id ? "2px solid var(--color-accent, #4da3ff)" : "2px solid transparent",
          borderRadius: 0,
        }}
      >
        {label}
      </button>
    );

    return (
      <>
        <p className="scrubber2-muted" style={{ marginTop: 0 }}>
          Define <code>def transform(payload):</code> and return a flat dict of <strong>scalar</strong> values only. No{" "}
          <code>import</code>. Stick to the helpers in the panel — preview may run with non-empty code even when
          disabled; saving still uses the checkbox.
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem 1rem",
            alignItems: "flex-start",
            marginBottom: "0.5rem",
          }}
        >
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: "0 0 auto" }}>
            <input
              type="checkbox"
              checked={model.derived.enabled}
              onChange={(e) => setModel((m) => ({ ...m, derived: { ...m.derived, enabled: e.target.checked } }))}
            />
            Enable derived transform
          </label>
          <div
            style={{
              flex: "1 1 260px",
              minWidth: 220,
              border: "1px solid var(--color-border, rgba(255,255,255,0.12))",
              borderRadius: 8,
              padding: "0.5rem 0.65rem",
              background: "var(--color-surface-raised, rgba(0,0,0,0.15))",
            }}
          >
            <div style={{ fontSize: "0.68rem", fontWeight: 600, marginBottom: 6, letterSpacing: "0.02em" }}>
              Allowed helpers (server)
            </div>
            <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              {tabBtn("math", "Math")}
              {tabBtn("stat", "Stat")}
              {tabBtn("string", "String")}
              {tabBtn("date", "Date")}
              {tabBtn("loop", "Loops")}
              {tabBtn("example", "Example")}
            </div>
            <div
              role="tabpanel"
              className="scrubber2-muted"
              style={{ fontSize: "0.72rem", lineHeight: 1.5, marginTop: 8 }}
            >
              {derivedHelpTab === "math" && (
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  <li>
                    Built-ins: <code>abs</code>, <code>round</code>, <code>min</code>, <code>max</code>, <code>sum</code>,{" "}
                    <code>pow</code>, <code>int</code>, <code>float</code>, <code>str</code>, <code>bool</code>, <code>len</code>
                  </li>
                  <li>
                    Helpers: <code>sqrt</code>, <code>log</code>
                  </li>
                  <li>
                    Random: <code>randint(a, b)</code> (inclusive integers), <code>random_float()</code> (uniform float in{" "}
                    <code>[0, 1)</code>), <code>random_float(lo, hi)</code> (uniform float between bounds).
                  </li>
                </ul>
              )}
              {derivedHelpTab === "stat" && (
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  <li>
                    <code>mean</code>, <code>median</code>, <code>stdev</code> (sequences of numbers)
                  </li>
                </ul>
              )}
              {derivedHelpTab === "string" && (
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  <li>
                    <code>lower</code>, <code>upper</code>, <code>strip</code>, <code>replace</code>, <code>split</code>,{" "}
                    <code>join</code>
                  </li>
                  <li>
                    Regex: injected <code>re</code> (no <code>import</code>); use the editor template for match/find/sub patterns.
                  </li>
                </ul>
              )}
              {derivedHelpTab === "date" && (
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  <li>
                    Types: <code>datetime</code>, <code>date</code>, <code>time</code>, <code>timedelta</code>,{" "}
                    <code>timezone</code>
                  </li>
                  <li>
                    Helpers: <code>now_iso</code>, <code>parse_iso</code>, <code>to_epoch</code>, <code>format_date</code>
                  </li>
                </ul>
              )}
              {derivedHelpTab === "loop" && (
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  <li>
                    Normal Python: <code>if</code> / <code>elif</code> / <code>else</code>, <code>for</code>, <code>while</code>,{" "}
                    comprehensions
                  </li>
                  <li>
                    Iteration helpers: <code>range</code>, <code>enumerate</code>, <code>zip</code>, <code>sorted</code>,{" "}
                    <code>reversed</code>, <code>map</code>, <code>filter</code>
                  </li>
                </ul>
              )}
              {derivedHelpTab === "example" && (
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "ui-monospace, monospace",
                    fontSize: "0.68rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {`def transform(payload):
    n = int(payload.get("count", 0))
    total = 0
    for i in range(n):
        total += i
    return {
        "total": total,
        "label": upper(strip(str(payload.get("id", "")))),
        "roll": randint(1, 6),
    }`}
                </pre>
              )}
            </div>
          </div>
        </div>
        <textarea
          className="scrubber2-input"
          style={{ width: "100%", minHeight: 160, fontFamily: "ui-monospace, monospace", fontSize: "0.78rem" }}
          value={model.derived.code}
          onChange={(e) => setModel((m) => ({ ...m, derived: { ...m.derived, code: e.target.value } }))}
        />
        <div className="scrubber2-toolbar">
          <button type="button" className="scrubber2-btn scrubber2-btn--ghost" onClick={onRequestPreview}>
            Validate via preview
          </button>
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            onClick={async () => {
              if (!rawId) return;
              try {
                const mapping = buildScrubberStudioMappingForPreview(
                  model,
                  { objectName: "preview", version: "0", parseAs: "auto" },
                  samplePayload ?? {},
                  { enableDerivedWhenCodePresent: true },
                );
                await apiFetch("/scrubber/preview", {
                  method: "POST",
                  json: { raw_object_id: rawId, mapping, use_stored_mapping: false },
                });
                onRequestPreview();
              } catch {
                onRequestPreview();
              }
            }}
          >
            Quick server check
          </button>
        </div>
      </>
    );
  }

  if (stepIndex === 4) {
    const sourceFields = resolveSemanticsDefaultSourceFields(
      pathSamplePreview,
      fieldsFromPreview,
      fieldsEarlyPipeline,
    );
    return (
      <>
        {!pathSamplePreview ? (
          <p className="scrubber2-muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>
            Run <strong>Validate</strong> (server preview) to load field paths from the transformed payload — including
            derived fields and excluding dropped paths. After rows exist, use <strong>Select all for AI</strong> to
            enable AI exposure on every row with a path.
          </p>
        ) : (
          <p className="scrubber2-muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>
            Use <strong>Default Attributes</strong> to insert <strong>one row per field</strong> from the validated
            preview (preview order), with type and default labels. Existing labels, roles, and AI flags for matching
            paths are kept; extra rows you added manually remain below. Use <strong>Select all for AI</strong> to turn
            on AI exposure for every row that has a path. The <strong>Type</strong> column is discovery /
            display only — binary, CSV, hex, and array shapes are <strong>not</strong> decoded unless you add an
            explicit <code style={{ fontSize: "0.75em" }}>decode_series</code> step (Configure decode series).
          </p>
        )}
        <div className="scrubber2-toolbar" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            disabled={sourceFields.length === 0}
            title={
              sourceFields.length === 0
                ? "No field list yet — run Validate (header) after choosing a raw sample, or wait for the explorer to load."
                : "Fill Semantics: one row per field from the preview (or pipeline pickers if preview paths are empty)."
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              applyDefaultFieldSemanticsFromSource(setModel, sourceFields);
            }}
          >
            Default Attributes
          </button>
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            disabled={!model.fieldSemantics.some((r) => r.path.trim())}
            title="Set AI exposure on for every row that has a path (skips empty rows)."
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setModel((m) => ({
                ...m,
                fieldSemantics: m.fieldSemantics.map((fs) =>
                  fs.path.trim() ? { ...fs, aiExposed: true } : fs,
                ),
              }));
            }}
          >
            Select all for AI
          </button>
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            onClick={() =>
              setModel((m) => ({
                ...m,
                fieldSemantics: [...m.fieldSemantics, { path: "", type: "string", roles: [] }],
              }))
            }
          >
            Add row
          </button>
          <span className="scrubber2-muted" style={{ fontSize: "0.72rem", alignSelf: "center", marginLeft: "auto" }}>
            decode_series steps: <strong>{model.decodeSeriesSteps?.length ?? 0}</strong>
          </span>
        </div>
        <div className="scrubber2-table-scroll">
          <table className="scrubber2-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Type</th>
                <th>Decode series</th>
                <th>Label</th>
                <th className="scrubber2-col-roles">Roles</th>
                <th>AI</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.fieldSemantics.map((row, i) => (
                <tr key={row.path ? `sem-${row.path}` : `sem-empty-${i}`}>
                  <td>
                    <Scrubber2FieldPicker
                      fields={pickerFields}
                      value={row.path}
                      onChange={(p) =>
                        setModel((m) => {
                          const fs = [...m.fieldSemantics];
                          const hit = pickerFields.find((x) => x.path === p);
                          fs[i] = { ...fs[i], path: p, type: hit?.type ?? fs[i].type };
                          return { ...m, fieldSemantics: fs };
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="scrubber2-input"
                      value={row.type}
                      onChange={(e) =>
                        setModel((m) => {
                          const fs = [...m.fieldSemantics];
                          fs[i] = { ...fs[i], type: e.target.value };
                          return { ...m, fieldSemantics: fs };
                        })
                      }
                    />
                  </td>
                  <td>
                    {(() => {
                      const decodeHint =
                        row.path.trim().length > 0
                          ? suggestDecodeSeriesForField(row.path, row.type, pathSampleRoot)
                          : null;
                      return decodeHint ? (
                        <button
                          type="button"
                          className="scrubber2-btn scrubber2-btn--ghost"
                          style={{ fontSize: "0.72rem", padding: "0.2rem 0.4rem", whiteSpace: "nowrap" }}
                          title={`Detected: ${decodeHint.detected}. Opens config — nothing is decoded until you confirm.`}
                          onClick={() => setDecodeSeriesModal({ sourcePath: row.path.trim(), suggestion: decodeHint })}
                        >
                          Configure…
                        </button>
                      ) : (
                        <span className="scrubber2-muted" style={{ fontSize: "0.72rem" }}>
                          —
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <input
                      className="scrubber2-input"
                      value={row.label ?? ""}
                      onChange={(e) =>
                        setModel((m) => {
                          const fs = [...m.fieldSemantics];
                          fs[i] = { ...fs[i], label: e.target.value };
                          return { ...m, fieldSemantics: fs };
                        })
                      }
                    />
                  </td>
                  <td className="scrubber2-col-roles">
                    <div className="scrubber2-chip-row">
                      {SCRUBBER2_SEMANTIC_ROLES.map((role) => {
                        const rowRoles = Array.isArray(row.roles) ? row.roles : [];
                        const on = rowRoles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            className={`scrubber2-chip${on ? " scrubber2-chip--on" : ""}`}
                            onClick={() =>
                              setModel((m) => {
                                const fs = [...m.fieldSemantics];
                                const cur = Array.isArray(fs[i].roles) ? fs[i].roles : [];
                                const roles = new Set(cur);
                                if (roles.has(role)) roles.delete(role);
                                else roles.add(role);
                                fs[i] = { ...fs[i], roles: [...roles] };
                                return { ...m, fieldSemantics: fs };
                              })
                            }
                          >
                            {role}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(row.aiExposed)}
                      onChange={(e) =>
                        setModel((m) => {
                          const fs = [...m.fieldSemantics];
                          fs[i] = { ...fs[i], aiExposed: e.target.checked };
                          return { ...m, fieldSemantics: fs };
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="scrubber2-btn scrubber2-btn--ghost"
                      onClick={() =>
                        setModel((m) => ({
                          ...m,
                          fieldSemantics: m.fieldSemantics.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {decodeSeriesModal ? (
          <DecodeSeriesConfigModal
            open
            sourcePath={decodeSeriesModal.sourcePath}
            suggestion={decodeSeriesModal.suggestion}
            onClose={() => setDecodeSeriesModal(null)}
            onConfirm={(step) =>
              setModel((m) => ({
                ...m,
                decodeSeriesSteps: [...(m.decodeSeriesSteps ?? []), step],
              }))
            }
          />
        ) : null}
      </>
    );
  }

  if (stepIndex === 5) {
    const cfg = model.health.config;
    return (
      <>
        {!pathSamplePreview ? (
          <p className="scrubber2-muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>
            Run <strong>Validate</strong> (server preview) to load field paths from the transformed payload.
          </p>
        ) : null}
        <label>
          <span className="scrubber2-muted">Mode</span>
          <select
            className="scrubber2-input"
            style={{ display: "block", marginTop: 4, minWidth: 220 }}
            value={model.health.mode}
            onChange={(e) =>
              setModel((m) => ({
                ...m,
                health: { ...m.health, mode: e.target.value as Scrubber2Model["health"]["mode"] },
              }))
            }
          >
            <option value="incoming_field">Incoming health field</option>
            <option value="simple_rules">Simple rules</option>
            <option value="threshold_reference_json">Threshold reference JSON</option>
          </select>
        </label>
        {model.health.mode === "incoming_field" && (
          <div style={{ marginTop: "0.5rem" }}>
            <span className="scrubber2-muted">Source field</span>
            <Scrubber2FieldPicker
              fields={pickerFields}
              value={String(cfg.source_field ?? "")}
              onChange={(p) =>
                setModel((m) => ({
                  ...m,
                  health: { ...m.health, config: { ...m.health.config, source_field: p } },
                }))
              }
            />
          </div>
        )}
        {model.health.mode === "simple_rules" && (
          <>
            <p className="scrubber2-muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem", marginBottom: 0 }}>
              Lower priority number is evaluated first. First matching rule wins; otherwise the default status applies.
            </p>
            <label style={{ display: "block", marginTop: "0.5rem" }}>
              <span className="scrubber2-muted">Default when no rule matches</span>
              <select
                className="scrubber2-input"
                style={{ display: "block", marginTop: 4, minWidth: 160 }}
                value={String(cfg.default_status ?? "green")}
                onChange={(e) =>
                  setModel((m) => ({
                    ...m,
                    health: {
                      ...m.health,
                      config: { ...m.health.config, default_status: e.target.value },
                    },
                  }))
                }
              >
                <option value="green">green</option>
                <option value="yellow">yellow</option>
                <option value="red">red</option>
              </select>
            </label>
            <div className="scrubber2-toolbar" style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="scrubber2-btn scrubber2-btn--ghost"
                onClick={() =>
                  setModel((m) => {
                    const c = m.health.config;
                    const rr = Array.isArray(c.rules) ? [...c.rules] : [];
                    rr.push({
                      name: `rule${rr.length + 1}`,
                      condition: "",
                      status: "yellow",
                      priority: String((rr.length + 1) * 10),
                      code: "",
                      message: "",
                    });
                    return { ...m, health: { ...m.health, config: { ...c, rules: rr } } };
                  })
                }
              >
                Add rule
              </button>
            </div>
            <div className="scrubber2-table-scroll" style={{ marginTop: "0.35rem" }}>
              <table className="scrubber2-table">
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Condition</th>
                    <th>Status</th>
                    <th>Message</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!Array.isArray(cfg.rules) || cfg.rules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="scrubber2-muted" style={{ padding: "0.75rem" }}>
                        No rules yet. Use default only, or add rules (e.g. path checks you will wire in mapping JSON).
                      </td>
                    </tr>
                  ) : (
                    cfg.rules.map((rawRow, i) => {
                      const row = isObjectRecord(rawRow) ? rawRow : {};
                      return (
                        <tr key={i}>
                          <td>
                            <input
                              className="scrubber2-input"
                              style={{ width: 72 }}
                              value={String(row.priority ?? "")}
                              onChange={(e) =>
                                setModel((m) => {
                                  const c = m.health.config;
                                  const rr = Array.isArray(c.rules) ? [...c.rules] : [];
                                  const prev = isObjectRecord(rr[i]) ? rr[i] : {};
                                  rr[i] = { ...prev, priority: e.target.value };
                                  return { ...m, health: { ...m.health, config: { ...c, rules: rr } } };
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="scrubber2-input"
                              style={{ minWidth: 140 }}
                              placeholder="e.g. path or expression"
                              value={String(row.condition ?? "")}
                              onChange={(e) =>
                                setModel((m) => {
                                  const c = m.health.config;
                                  const rr = Array.isArray(c.rules) ? [...c.rules] : [];
                                  const prev = isObjectRecord(rr[i]) ? rr[i] : {};
                                  rr[i] = { ...prev, condition: e.target.value };
                                  return { ...m, health: { ...m.health, config: { ...c, rules: rr } } };
                                })
                              }
                            />
                          </td>
                          <td>
                            <select
                              className="scrubber2-input"
                              value={String(row.status ?? "yellow")}
                              onChange={(e) =>
                                setModel((m) => {
                                  const c = m.health.config;
                                  const rr = Array.isArray(c.rules) ? [...c.rules] : [];
                                  const prev = isObjectRecord(rr[i]) ? rr[i] : {};
                                  rr[i] = { ...prev, status: e.target.value };
                                  return { ...m, health: { ...m.health, config: { ...c, rules: rr } } };
                                })
                              }
                            >
                              <option value="green">green</option>
                              <option value="yellow">yellow</option>
                              <option value="red">red</option>
                            </select>
                          </td>
                          <td>
                            <input
                              className="scrubber2-input"
                              style={{ minWidth: 120 }}
                              placeholder="Optional"
                              value={String(row.message ?? "")}
                              onChange={(e) =>
                                setModel((m) => {
                                  const c = m.health.config;
                                  const rr = Array.isArray(c.rules) ? [...c.rules] : [];
                                  const prev = isObjectRecord(rr[i]) ? rr[i] : {};
                                  rr[i] = { ...prev, message: e.target.value };
                                  return { ...m, health: { ...m.health, config: { ...c, rules: rr } } };
                                })
                              }
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="scrubber2-btn scrubber2-btn--ghost"
                              onClick={() =>
                                setModel((m) => {
                                  const c = m.health.config;
                                  const rr = Array.isArray(c.rules) ? c.rules.filter((_, j) => j !== i) : [];
                                  return { ...m, health: { ...m.health, config: { ...c, rules: rr } } };
                                })
                              }
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {model.health.mode === "threshold_reference_json" && (
          <textarea
            className="scrubber2-input"
            style={{ width: "100%", minHeight: 120, marginTop: "0.35rem", fontFamily: "ui-monospace, monospace" }}
            placeholder='{"reference_name":"…","normal":{},"warning":{},"critical":{}}'
            value={typeof cfg.inline_json === "string" ? cfg.inline_json : ""}
            onChange={(e) =>
              setModel((m) => ({
                ...m,
                health: { ...m.health, config: { ...m.health.config, inline_json: e.target.value } },
              }))
            }
          />
        )}
      </>
    );
  }

  if (stepIndex === 6) {
    const metricPaths = model.fieldSemantics.filter((s) =>
      (Array.isArray(s.roles) ? s.roles : []).includes("metric"),
    );
    return (
      <>
        {!pathSamplePreview ? (
          <p className="scrubber2-muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>
            Run <strong>Validate</strong> (server preview) so Semantics and KPI paths match the transformed payload.
          </p>
        ) : null}
        <p className="scrubber2-muted">Only fields with role <strong>metric</strong> in Semantics are eligible.</p>
        <div className="scrubber2-toolbar">
          <button
            type="button"
            className="scrubber2-btn scrubber2-btn--ghost"
            onClick={() =>
              setModel((m) => ({
                ...m,
                kpi: { metrics: [...m.kpi.metrics, { path: "", aggregation: "numeric", window: "1h / 24h" }] },
              }))
            }
          >
            Add metric
          </button>
        </div>
        <div className="scrubber2-table-scroll">
          <table className="scrubber2-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Aggregation</th>
                <th>Window</th>
                <th>Rollup label</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.kpi.metrics.map((row, i) => (
                <tr key={i}>
                  <td>
                    <select
                      className="scrubber2-input"
                      value={row.path}
                      onChange={(e) =>
                        setModel((m) => {
                          const metrics = [...m.kpi.metrics];
                          metrics[i] = { ...metrics[i], path: e.target.value };
                          return { ...m, kpi: { metrics } };
                        })
                      }
                    >
                      <option value="">Select metric field…</option>
                      {metricPaths.map((s) => (
                        <option key={s.path} value={s.path}>
                          {s.path}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="scrubber2-input"
                      value={row.aggregation}
                      onChange={(e) =>
                        setModel((m) => {
                          const metrics = [...m.kpi.metrics];
                          metrics[i] = { ...metrics[i], aggregation: e.target.value };
                          return { ...m, kpi: { metrics } };
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      className="scrubber2-input"
                      value={row.window}
                      onChange={(e) =>
                        setModel((m) => {
                          const metrics = [...m.kpi.metrics];
                          metrics[i] = { ...metrics[i], window: e.target.value };
                          return { ...m, kpi: { metrics } };
                        })
                      }
                    >
                      <option value="1h / 24h">1h + 24h</option>
                      <option value="1h">1h only</option>
                      <option value="24h">24h only</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="scrubber2-input"
                      value={row.rollup ?? ""}
                      onChange={(e) =>
                        setModel((m) => {
                          const metrics = [...m.kpi.metrics];
                          metrics[i] = { ...metrics[i], rollup: e.target.value };
                          return { ...m, kpi: { metrics } };
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="scrubber2-btn scrubber2-btn--ghost"
                      onClick={() =>
                        setModel((m) => ({
                          ...m,
                          kpi: { metrics: m.kpi.metrics.filter((_, j) => j !== i) },
                        }))
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (stepIndex === 7) {
    return (
      <>
        {!pathSamplePreview ? (
          <p className="scrubber2-muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>
            Run <strong>Validate</strong> (server preview) to pick geo fields from the transformed payload.
          </p>
        ) : null}
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <label>
            <span className="scrubber2-muted">Latitude</span>
            <div>
              <Scrubber2FieldPicker
                fields={pickerFields}
                value={model.location.latitudePath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, latitudePath: p } }))}
              />
            </div>
          </label>
          <label>
            <span className="scrubber2-muted">Longitude</span>
            <div>
              <Scrubber2FieldPicker
                fields={pickerFields}
                value={model.location.longitudePath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, longitudePath: p } }))}
              />
            </div>
          </label>
          <label>
            <span className="scrubber2-muted">Altitude (optional)</span>
            <div>
              <Scrubber2FieldPicker
                fields={pickerFields}
                value={model.location.altitudePath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, altitudePath: p } }))}
              />
            </div>
          </label>
          <label>
            <span className="scrubber2-muted">Heading (optional)</span>
            <div>
              <Scrubber2FieldPicker
                fields={pickerFields}
                value={model.location.headingPath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, headingPath: p } }))}
              />
            </div>
          </label>
        </div>
        {pathSampleRoot ? (
          <div className="scrubber2-muted" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
            Sample lat:{" "}
            {model.location.latitudePath ? String(getByPath(pathSampleRoot, model.location.latitudePath) ?? "—") : "—"}
          </div>
        ) : null}
      </>
    );
  }

  if (stepIndex === 8) {
    return (
      <div className="scrubber2-code-scroll">
        <p className="scrubber2-muted">Compile / publish validation summary</p>
        <pre>{JSON.stringify({ pipeline: model }, null, 2)}</pre>
      </div>
    );
  }

  return null;
}
