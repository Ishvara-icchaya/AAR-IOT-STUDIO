import { useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import type { KpiMetricRow, StudioDraftForm } from "@/types/scrubberStudioForm";

const inp: CSSProperties = {
  padding: "0.45rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
};
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.35rem",
  fontSize: "0.76rem",
  borderBottom: "1px solid var(--color-border)",
};
const td: CSSProperties = {
  padding: "0.35rem",
  fontSize: "0.78rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};
const rowChk: CSSProperties = { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" };

const pathRefBox: CSSProperties = {
  fontSize: "0.76rem",
  lineHeight: 1.45,
  color: "var(--color-text)",
  background: "color-mix(in oklab, var(--color-surface-elevated) 92%, transparent)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: "0.5rem 0.65rem",
  marginBottom: "0.65rem",
};

function typeLabel(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Leaf paths whose sample looks numeric — suitable for time-series KPI metrics. */
function isMetricCandidateSample(v: unknown): boolean {
  if (typeof v === "number" && Number.isFinite(v)) return true;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n);
  }
  return false;
}

export function KpiStepEditor(props: {
  form: StudioDraftForm;
  setForm: Dispatch<SetStateAction<StudioDraftForm>>;
  pathSuggestions: string[];
  pathSamples: Record<string, unknown>;
  /** Pipeline “select path” (optional) — shown so KPI paths can be read as `parent.child` from raw root. */
  selectPath?: string;
}) {
  const { form, setForm, pathSuggestions, pathSamples, selectPath } = props;
  const [filter, setFilter] = useState("");

  const metricAttributePaths = useMemo(() => {
    return pathSuggestions.filter((p) => isMetricCandidateSample(pathSamples[p])).sort((a, b) => a.localeCompare(b));
  }, [pathSuggestions, pathSamples]);

  function toggleDisplay(path: string) {
    setForm((f) => {
      const s = new Set(f.kpiDisplayFields);
      if (s.has(path)) s.delete(path);
      else s.add(path);
      return { ...f, kpiDisplayFields: Array.from(s).sort((a, b) => a.localeCompare(b)) };
    });
  }

  function setMetricField(i: number, patch: Partial<KpiMetricRow>) {
    setForm((f) => {
      const next = [...f.kpiMetrics];
      next[i] = { ...next[i], ...patch };
      return { ...f, kpiMetrics: next };
    });
  }

  const q = filter.trim().toLowerCase();
  const paths = q ? pathSuggestions.filter((p) => p.toLowerCase().includes(q)) : pathSuggestions;

  const sp = (selectPath ?? "").trim();

  return (
    <>
      <div style={pathRefBox} role="note" aria-label="Dotted path reference">
        <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.35rem", color: "var(--color-text)" }}>
          Parent path (reference)
        </div>
        <p style={{ margin: "0 0 0.35rem", color: "var(--color-text-muted)" }}>
          Use <strong>dotted paths</strong> from the <strong>raw JSON root</strong>: each segment is an object key, joined by{" "}
          <code style={{ fontSize: "0.85em" }}>.</code> Example: <code style={{ fontSize: "0.85em" }}>payload.attribute</code>{" "}
          → the <code style={{ fontSize: "0.85em" }}>attribute</code> field inside <code style={{ fontSize: "0.85em" }}>payload</code>
          . Another: <code style={{ fontSize: "0.85em" }}>readings.temp_c</code>.
        </p>
        {sp ? (
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
            <strong>Select path</strong> (pipeline root) is <code style={{ fontSize: "0.85em" }}>{sp}</code> — paths in the lists
            below are still <strong>full paths from the raw root</strong> (e.g. if your data is under <code style={{ fontSize: "0.85em" }}>payload</code>, use{" "}
            <code style={{ fontSize: "0.85em" }}>payload.…</code>).
          </p>
        ) : (
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
            If your telemetry is nested (e.g. <code style={{ fontSize: "0.85em" }}>{`{ "payload": { "attribute": 1 } }`}</code>
            ), the field path is <code style={{ fontSize: "0.85em" }}>payload.attribute</code>.
          </p>
        )}
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 0 }}>
        Choose transformed fields for dashboard detail (display), and numeric paths for KPI time-series. Browser preview does not
        write history or Redis; the worker does at runtime.
      </p>
      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
        Search fields
        <input style={inp} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by path…" />
      </label>

      <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.35rem" }}>Display fields (dashboard click)</div>
      <div
        className="table-scroll-sticky"
        style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", maxHeight: "220px", overflow: "auto" }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--color-surface-elevated)" }}>
              <th style={th}>Show</th>
              <th style={th}>Field path</th>
              <th style={th}>Sample</th>
              <th style={th}>Type</th>
            </tr>
          </thead>
          <tbody>
            {paths.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ ...td, color: "var(--color-text-muted)" }}>
                  Load raw JSON to list leaf paths.
                </td>
              </tr>
            ) : (
              paths.map((p) => {
                const sample = pathSamples[p];
                return (
                  <tr key={p}>
                    <td style={td}>
                      <input type="checkbox" checked={form.kpiDisplayFields.includes(p)} onChange={() => toggleDisplay(p)} />
                    </td>
                    <td style={td}>
                      <code>{p}</code>
                    </td>
                    <td style={{ ...td, maxWidth: "12rem", overflow: "hidden", textOverflow: "ellipsis" }}>{String(sample ?? "—")}</td>
                    <td style={td}>{typeLabel(sample)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="scrubber-btn scrubber-btn--ghost"
          onClick={() => setForm((f) => ({ ...f, kpiDisplayFields: [...pathSuggestions] }))}
        >
          Select all (filtered)
        </button>
        <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setForm((f) => ({ ...f, kpiDisplayFields: [] }))}>
          Clear all
        </button>
      </div>

      <div style={{ fontWeight: 600, fontSize: "0.85rem", margin: "0.85rem 0 0.35rem" }}>KPI metrics (time-series)</div>
      <p style={{ fontSize: "0.76rem", color: "var(--color-text-muted)", margin: "0 0 0.5rem" }}>
        Choose from <strong>numeric attributes</strong> detected on the current raw/transform sample (same dotted paths as above). Load or
        refresh raw JSON if the list is empty.
      </p>
      {metricAttributePaths.length === 0 ? (
        <p className="dash-widget__muted" style={{ fontSize: "0.8rem", margin: "0 0 0.65rem" }}>
          No numeric leaf fields found — metrics require a number (or numeric string) in the sample.
        </p>
      ) : null}
      {form.kpiMetrics.map((row, i) => (
        <div
          key={i}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            padding: "0.5rem",
            marginBottom: "0.5rem",
            display: "grid",
            gap: "0.35rem",
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          <label style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", gridColumn: "1 / -1" }}>
            Attribute
            <select
              style={{ ...inp, width: "100%", marginTop: "0.2rem" }}
              value={row.fieldPath}
              onChange={(e) => setMetricField(i, { fieldPath: e.target.value })}
              disabled={metricAttributePaths.length === 0 && !row.fieldPath}
            >
              <option value="">— Select attribute —</option>
              {row.fieldPath && !metricAttributePaths.includes(row.fieldPath) ? (
                <option value={row.fieldPath}>{row.fieldPath} (saved — not in current sample)</option>
              ) : null}
              {metricAttributePaths.map((p) => {
                const s = pathSamples[p];
                const hint = s !== undefined ? ` — ${String(s)}` : "";
                return (
                  <option key={p} value={p}>
                    {p}
                    {hint.length > 48 ? `${hint.slice(0, 45)}…` : hint}
                  </option>
                );
              })}
            </select>
          </label>
          <label style={{ ...rowChk, fontSize: "0.82rem" }}>
            <input
              type="checkbox"
              checked={row.storeHistory}
              onChange={(e) => setMetricField(i, { storeHistory: e.target.checked })}
            />{" "}
            Track metric
          </label>
          <label style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
            Unit
            <input style={{ ...inp, width: "100%", marginTop: "0.2rem" }} value={row.unit} onChange={(e) => setMetricField(i, { unit: e.target.value })} />
          </label>
          <label style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
            Label
            <input style={{ ...inp, width: "100%", marginTop: "0.2rem" }} value={row.label} onChange={(e) => setMetricField(i, { label: e.target.value })} />
          </label>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <label style={rowChk}>
              <input type="checkbox" checked={row.win1h} onChange={(e) => setMetricField(i, { win1h: e.target.checked })} /> 1h
            </label>
            <label style={rowChk}>
              <input type="checkbox" checked={row.win24h} onChange={(e) => setMetricField(i, { win24h: e.target.checked })} /> 24h
            </label>
          </div>
          <button
            type="button"
            className="scrubber-btn scrubber-btn--ghost"
            style={{ justifySelf: "start" }}
            onClick={() =>
              setForm((f) => ({
                ...f,
                kpiMetrics: f.kpiMetrics.filter((_, j) => j !== i),
              }))
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="scrubber-btn scrubber-btn--ghost"
        onClick={() =>
          setForm((f) => ({
            ...f,
            kpiMetrics: [
              ...f.kpiMetrics,
              { fieldPath: "", storeHistory: true, unit: "", label: "", win1h: true, win24h: true, type: "numeric" },
            ],
          }))
        }
      >
        Add metric
      </button>
    </>
  );
}
