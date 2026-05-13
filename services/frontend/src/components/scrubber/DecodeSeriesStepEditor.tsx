import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import type { StudioDraftForm } from "@/types/scrubberStudioForm";

const MODES = ["scalar", "array", "base64_binary", "csv_numbers", "hex_binary"] as const;
const BINARY_DT = ["int16", "int32", "float32"] as const;
const SCALAR_DT = ["float", "int", "int16", "int32", "float32"] as const;
const AGG_KEYS = ["avg", "min", "max", "latest", "count"] as const;

const inp: CSSProperties = {
  padding: "0.45rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontSize: "0.82rem",
};
const lbl: CSSProperties = {
  display: "grid",
  gap: "0.3rem",
  fontSize: "0.78rem",
  color: "var(--color-text-muted)",
};
const rowChk: CSSProperties = { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem" };
const card: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: "0.65rem",
  marginBottom: "0.65rem",
  background: "color-mix(in oklab, var(--color-surface) 70%, transparent)",
};

function pick(s: Record<string, unknown>, a: string, b?: string): unknown {
  if (a in s) return s[a];
  if (b && b in s) return s[b];
  return undefined;
}

export function newDecodeSeriesStep(): Record<string, unknown> {
  return {
    step_type: "decode_series",
    source_path: "",
    target_path: "",
    mode: "array",
    data_type: "float",
    encoding: "base64",
    byte_order: "little",
    scale: 1,
    offset: 0,
    unit: "",
    sample_rate_hz: null,
    store_samples: true,
    max_samples_to_store: 1000,
    aggregations: ["avg", "min", "max", "latest", "count"],
  };
}

/** Normalize rows for `scrubberStudio.draft.decodeSeriesSteps` (snake_case, drops incomplete rows). */
export function serializeDecodeSeriesStepsForDraft(rows: Record<string, unknown>[]): Record<string, unknown>[] | undefined {
  const out: Record<string, unknown>[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const s = raw as Record<string, unknown>;
    const source_path = String(pick(s, "source_path", "sourcePath") ?? "").trim();
    const target_path = String(pick(s, "target_path", "targetPath") ?? "").trim();
    if (!source_path || !target_path) continue;
    const mode = String(pick(s, "mode") ?? "array").trim();
    if (!MODES.includes(mode as (typeof MODES)[number])) continue;
    const data_type = String(pick(s, "data_type", "dataType") ?? "float").toLowerCase().trim();
    const row: Record<string, unknown> = {
      step_type: "decode_series",
      source_path,
      target_path,
      mode,
      data_type,
      scale: numOr(pick(s, "scale"), 1),
      offset: numOr(pick(s, "offset"), 0),
      store_samples: pick(s, "store_samples", "storeSamples") !== false,
      max_samples_to_store: intOr(pick(s, "max_samples_to_store", "maxSamplesToStore"), 1000),
    };
    const unit = pick(s, "unit");
    if (typeof unit === "string" && unit.trim()) row.unit = unit.trim();
    const srh = pick(s, "sample_rate_hz", "sampleRateHz");
    if (srh === "" || srh == null) row.sample_rate_hz = null;
    else row.sample_rate_hz = typeof srh === "number" && Number.isFinite(srh) ? srh : Number(srh);
    if (mode === "base64_binary" || mode === "hex_binary") {
      row.byte_order = String(pick(s, "byte_order", "byteOrder") ?? "little").toLowerCase() === "big" ? "big" : "little";
      if (mode === "base64_binary") row.encoding = "base64";
    }
    const ag = pick(s, "aggregations");
    if (Array.isArray(ag) && ag.length) {
      row.aggregations = ag.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase().trim());
    } else {
      row.aggregations = ["latest", "count"];
    }
    out.push(row);
  }
  return out.length ? out : undefined;
}

function numOr(v: unknown, d: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function intOr(v: unknown, d: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.max(0, n) : d;
}

function str(s: Record<string, unknown>, a: string, b?: string): string {
  const v = pick(s, a, b);
  return v == null ? "" : String(v);
}

function rowsForEdit(f: StudioDraftForm): Record<string, unknown>[] {
  return f.decodeSeriesSteps.length > 0 ? f.decodeSeriesSteps : [newDecodeSeriesStep()];
}

function patchRow(f: StudioDraftForm, i: number, patch: Record<string, unknown>): Record<string, unknown>[] {
  const base = rowsForEdit(f);
  const next = [...base];
  next[i] = { ...(next[i] as Record<string, unknown>), ...patch };
  return next;
}

export function DecodeSeriesStepEditor(props: {
  form: StudioDraftForm;
  setForm: Dispatch<SetStateAction<StudioDraftForm>>;
  datalistId: string;
}): ReactNode {
  const { form, setForm, datalistId } = props;
  const rows = rowsForEdit(form);

  return (
    <div>
      <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 0, marginBottom: "0.65rem" }}>
        Decode packed telemetry into <code>samples</code>, <code>meta</code>, and <code>aggregations</code> at <code>target_path</code>. Runs
        after <strong>Derived fields</strong> and before <strong>Function based</strong>. Full reference:{" "}
        <code>docs/SCRUBBER_DECODE_SERIES_SPEC.md</code>.
      </p>
      {rows.map((raw, i) => {
        const s = raw as Record<string, unknown>;
        const mode = str(s, "mode") || "array";
        const isBinary = mode === "base64_binary" || mode === "hex_binary";
        const dtOpts: readonly string[] = isBinary ? BINARY_DT : SCALAR_DT;
        let dataType = str(s, "data_type", "dataType") || (isBinary ? "int32" : "float");
        if (!dtOpts.includes(dataType)) dataType = isBinary ? "int32" : "float";
        const aggs = Array.isArray(s.aggregations) ? (s.aggregations as unknown[]).map(String) : ["avg", "min", "max", "latest", "count"];

        return (
          <div key={i} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>Step {i + 1}</span>
              <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="scrubber-btn scrubber-btn--ghost"
                  disabled={i === 0}
                  onClick={() =>
                    setForm((f) => {
                      const a = rowsForEdit(f);
                      if (i === 0) return f;
                      const n = [...a];
                      [n[i - 1], n[i]] = [n[i], n[i - 1]];
                      return { ...f, decodeSeriesSteps: n };
                    })
                  }
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="scrubber-btn scrubber-btn--ghost"
                  disabled={i >= rows.length - 1}
                  onClick={() =>
                    setForm((f) => {
                      const a = rowsForEdit(f);
                      if (i >= a.length - 1) return f;
                      const n = [...a];
                      [n[i], n[i + 1]] = [n[i + 1], n[i]];
                      return { ...f, decodeSeriesSteps: n };
                    })
                  }
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="scrubber-btn scrubber-btn--ghost"
                  onClick={() =>
                    setForm((f) => {
                      const a = rowsForEdit(f).filter((_, j) => j !== i);
                      return { ...f, decodeSeriesSteps: a.length ? a : [] };
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "1fr 1fr", maxWidth: "100%" }}>
              <label style={lbl}>
                source_path
                <input
                  style={inp}
                  list={datalistId}
                  placeholder="e.g. body.pack.current"
                  value={str(s, "source_path", "sourcePath")}
                  onChange={(e) => setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { source_path: e.target.value }) }))}
                />
              </label>
              <label style={lbl}>
                target_path
                <input
                  style={inp}
                  list={datalistId}
                  placeholder="e.g. decoded.pack.current"
                  value={str(s, "target_path", "targetPath")}
                  onChange={(e) => setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { target_path: e.target.value }) }))}
                />
              </label>
              <label style={lbl}>
                mode
                <select
                  style={inp}
                  value={mode}
                  onChange={(e) => {
                    const m = e.target.value;
                    const nextDt = m === "base64_binary" || m === "hex_binary" ? "int32" : "float";
                    setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { mode: m, data_type: nextDt }) }));
                  }}
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label style={lbl}>
                data_type
                <select
                  style={inp}
                  value={dataType}
                  onChange={(e) => setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { data_type: e.target.value }) }))}
                >
                  {dtOpts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              {isBinary ? (
                <label style={lbl}>
                  byte_order
                  <select
                    style={inp}
                    value={str(s, "byte_order", "byteOrder") || "little"}
                    onChange={(e) => setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { byte_order: e.target.value }) }))}
                  >
                    <option value="little">little</option>
                    <option value="big">big</option>
                  </select>
                </label>
              ) : (
                <span />
              )}
              {mode === "base64_binary" ? (
                <label style={lbl}>
                  encoding
                  <input style={inp} value="base64" readOnly title="v1 supports base64 only" />
                </label>
              ) : (
                <span />
              )}
              <label style={lbl}>
                scale
                <input
                  type="number"
                  step="any"
                  style={inp}
                  value={String(pick(s, "scale") ?? 1)}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { scale: Number(e.target.value) || 0 }) }))
                  }
                />
              </label>
              <label style={lbl}>
                offset
                <input
                  type="number"
                  step="any"
                  style={inp}
                  value={String(pick(s, "offset") ?? 0)}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { offset: Number(e.target.value) || 0 }) }))
                  }
                />
              </label>
              <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                unit (optional)
                <input
                  style={inp}
                  placeholder="e.g. mA"
                  value={str(s, "unit")}
                  onChange={(e) => setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { unit: e.target.value }) }))}
                />
              </label>
              <label style={lbl}>
                sample_rate_hz (optional)
                <input
                  style={inp}
                  placeholder="empty = null"
                  value={s.sample_rate_hz == null ? "" : String(s.sample_rate_hz)}
                  onChange={(e) => {
                    const t = e.target.value.trim();
                    if (t === "") {
                      setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { sample_rate_hz: null }) }));
                      return;
                    }
                    const n = Number(t);
                    setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { sample_rate_hz: Number.isFinite(n) ? n : null }) }));
                  }}
                />
              </label>
              <label style={lbl}>
                max_samples_to_store
                <input
                  type="number"
                  min={0}
                  style={inp}
                  value={String(intOr(pick(s, "max_samples_to_store", "maxSamplesToStore"), 1000))}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      decodeSeriesSteps: patchRow(f, i, { max_samples_to_store: Math.max(0, Number.parseInt(e.target.value, 10) || 0) }),
                    }))
                  }
                />
              </label>
            </div>
            <label style={{ ...rowChk, marginTop: "0.5rem" }}>
              <input
                type="checkbox"
                checked={pick(s, "store_samples", "storeSamples") !== false}
                onChange={(e) =>
                  setForm((f) => ({ ...f, decodeSeriesSteps: patchRow(f, i, { store_samples: e.target.checked }) }))
                }
              />
              store_samples (off → empty samples array; aggregations still computed)
            </label>
            <div style={{ marginTop: "0.5rem" }}>
              <div style={{ fontSize: "0.76rem", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>aggregations</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.65rem" }}>
                {AGG_KEYS.map((k) => (
                  <label key={k} style={rowChk}>
                    <input
                      type="checkbox"
                      checked={aggs.includes(k)}
                      onChange={(e) => {
                        const on = e.target.checked;
                        const next = on ? [...new Set([...aggs, k])] : aggs.filter((x) => x !== k);
                        setForm((f) => ({
                          ...f,
                          decodeSeriesSteps: patchRow(f, i, { aggregations: next.length ? next : ["count"] }),
                        }));
                      }}
                    />
                    {k}
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="scrubber-btn scrubber-btn--ghost"
        onClick={() => setForm((f) => ({ ...f, decodeSeriesSteps: [...rowsForEdit(f), newDecodeSeriesStep()] }))}
      >
        Add decode series step
      </button>
    </div>
  );
}
