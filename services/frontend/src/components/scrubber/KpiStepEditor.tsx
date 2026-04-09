import { useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
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

function typeLabel(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export function KpiStepEditor(props: {
  form: StudioDraftForm;
  setForm: Dispatch<SetStateAction<StudioDraftForm>>;
  pathSuggestions: string[];
  pathSamples: Record<string, unknown>;
  datalistId: string;
}) {
  const { form, setForm, pathSuggestions, pathSamples, datalistId } = props;
  const [filter, setFilter] = useState("");

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

  return (
    <>
      <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 0 }}>
        Choose transformed fields for dashboard detail (display), and numeric paths for KPI time-series. Browser preview does not
        write history or Redis; the worker does at runtime.
      </p>
      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.82rem", marginBottom: "0.5rem" }}>
        Search fields
        <input style={inp} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by path…" />
      </label>

      <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.35rem" }}>Display fields (dashboard click)</div>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", maxHeight: "220px", overflow: "auto" }}>
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
            Field path
            <input
              style={{ ...inp, width: "100%", marginTop: "0.2rem" }}
              list={datalistId}
              value={row.fieldPath}
              onChange={(e) => setMetricField(i, { fieldPath: e.target.value })}
              placeholder="dotted path e.g. readings.temp_c"
            />
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
