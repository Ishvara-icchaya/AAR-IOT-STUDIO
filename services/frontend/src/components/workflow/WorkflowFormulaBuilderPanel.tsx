import type { CSSProperties } from "react";
import type { FormulaBuilderOp, FormulaBuilderRow } from "@/lib/workflowFormulaCodegen";
import { generatePythonFromRows } from "@/lib/workflowFormulaCodegen";

const OPS: { value: FormulaBuilderOp; label: string }[] = [
  { value: "literal", label: "Set literal" },
  { value: "copy", label: "Copy field → output" },
  { value: "add", label: "Add (numeric)" },
  { value: "sub", label: "Subtract (numeric)" },
  { value: "mul", label: "Multiply (numeric)" },
  { value: "div", label: "Divide (numeric)" },
  { value: "concat", label: "Concat strings" },
  { value: "upper", label: "Uppercase string" },
  { value: "lower", label: "Lowercase string" },
  { value: "strip", label: "Trim string" },
];

const inp: CSSProperties = {
  padding: "0.35rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontSize: "0.8rem",
  width: "100%",
};

function needsSecondOperand(op: FormulaBuilderOp): boolean {
  return ["add", "sub", "mul", "div", "concat"].includes(op);
}

function needsLeftPath(op: FormulaBuilderOp): boolean {
  return op !== "literal";
}

export function WorkflowFormulaBuilderPanel({
  rows,
  availableFields,
  disabled,
  onChangeRows,
  onGeneratedCode,
}: {
  rows: FormulaBuilderRow[];
  availableFields: string[];
  disabled: boolean;
  onChangeRows: (next: FormulaBuilderRow[]) => void;
  onGeneratedCode: (python: string) => void;
}) {
  function updateRow(id: string, patch: Partial<FormulaBuilderRow>) {
    onChangeRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    onChangeRows([
      ...rows,
      {
        id: crypto.randomUUID(),
        outputKey: "",
        op: "copy",
        leftPath: availableFields[0] ?? "",
        rightKind: "literal",
        literal: "",
        rightPath: "",
      },
    ]);
  }

  function removeRow(id: string) {
    if (rows.length <= 1) return;
    onChangeRows(rows.filter((r) => r.id !== id));
  }

  function applyAndSync() {
    onGeneratedCode(generatePythonFromRows(rows));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
      <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.45 }}>
        Each row writes one <strong>top-level</strong> key on the payload. Pick fields from the list (dotted paths). Click{" "}
        <strong>Generate / sync Python</strong> to update the Python tab (server runs <code style={{ fontSize: "0.68rem" }}>transform(payload)</code>).
      </p>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            padding: "0.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
          }}
        >
          <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            Output key
            <input
              style={inp}
              value={r.outputKey}
              disabled={disabled}
              onChange={(e) => updateRow(r.id, { outputKey: e.target.value })}
              placeholder="e.g. total_temp"
            />
          </label>
          <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            Operation
            <select style={inp} value={r.op} disabled={disabled} onChange={(e) => updateRow(r.id, { op: e.target.value as FormulaBuilderOp })}>
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {r.op === "literal" ? (
            <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              Literal
              <input
                style={inp}
                value={r.literal}
                disabled={disabled}
                onChange={(e) => updateRow(r.id, { literal: e.target.value })}
                placeholder='e.g. 42, "hello", true'
              />
            </label>
          ) : null}
          {needsLeftPath(r.op) ? (
            <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              Field (dotted path)
              <select
                style={inp}
                value={r.leftPath}
                disabled={disabled}
                onChange={(e) => updateRow(r.id, { leftPath: e.target.value })}
              >
                <option value="">— select —</option>
                {availableFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {needsSecondOperand(r.op) ? (
            <div style={{ display: "grid", gap: "0.35rem", gridTemplateColumns: "1fr 1fr", alignItems: "end" }}>
              <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                Second operand
                <select
                  style={inp}
                  value={r.rightKind}
                  disabled={disabled}
                  onChange={(e) => updateRow(r.id, { rightKind: e.target.value as FormulaBuilderRow["rightKind"] })}
                >
                  <option value="literal">{r.op === "concat" ? "Text literal" : "Number literal"}</option>
                  <option value="path">Another field</option>
                </select>
              </label>
              {r.rightKind === "path" ? (
                <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                  Other field
                  <select
                    style={inp}
                    value={r.rightPath}
                    disabled={disabled}
                    onChange={(e) => updateRow(r.id, { rightPath: e.target.value })}
                  >
                    <option value="">—</option>
                    {availableFields.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                  Value
                  <input
                    style={inp}
                    value={r.literal}
                    disabled={disabled}
                    onChange={(e) => updateRow(r.id, { literal: e.target.value })}
                    placeholder={r.op === "concat" ? "suffix" : "2"}
                  />
                </label>
              )}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" disabled={disabled || rows.length <= 1} style={{ fontSize: "0.72rem" }} onClick={() => removeRow(r.id)}>
              Remove row
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <button type="button" style={{ fontSize: "0.8rem" }} disabled={disabled} onClick={addRow}>
          Add row
        </button>
        <button type="button" style={{ fontSize: "0.8rem", fontWeight: 600 }} disabled={disabled} onClick={applyAndSync}>
          Generate / sync Python
        </button>
      </div>
    </div>
  );
}
