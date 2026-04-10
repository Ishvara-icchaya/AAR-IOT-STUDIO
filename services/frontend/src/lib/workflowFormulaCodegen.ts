/**
 * Generates sandboxed workflow formula Python from visual builder rows.
 * Matches server expectations: `transform(payload)` returns a dict of scalar/str values.
 */

export const WORKFLOW_FORMULA_PYTHON_EXAMPLE = `def transform(payload):
    """Example: read nested fields, compute a scalar, return new top-level keys."""
    a = payload.get("temperature")
    b = payload.get("setpoint")
    try:
        temp = float(a) if a is not None else 0.0
    except (TypeError, ValueError):
        temp = 0.0
    try:
        sp = float(b) if b is not None else 0.0
    except (TypeError, ValueError):
        sp = 0.0
    return {
        "delta_vs_setpoint": round(temp - sp, 2),
        "in_band": 1 if abs(temp - sp) <= 2.0 else 0,
    }`;

export type FormulaBuilderOp =
  | "copy"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "concat"
  | "upper"
  | "lower"
  | "strip"
  | "literal";

export type FormulaBuilderRow = {
  id: string;
  outputKey: string;
  op: FormulaBuilderOp;
  leftPath: string;
  rightKind: "none" | "literal" | "path";
  literal: string;
  rightPath: string;
};

export function defaultFormulaBuilderRows(): FormulaBuilderRow[] {
  return [
    {
      id: crypto.randomUUID(),
      outputKey: "example_sum",
      op: "add",
      leftPath: "",
      rightKind: "literal",
      literal: "0",
      rightPath: "",
    },
  ];
}

function pathCall(path: string): string {
  const p = path.trim();
  if (!p) return "None";
  return `_g(payload, ${JSON.stringify(p)})`;
}

function floatExpr(path: string): string {
  const g = pathCall(path);
  return `(float(${g}) if ${g} is not None else 0.0)`;
}

function strExpr(path: string): string {
  const g = pathCall(path);
  return `("" if ${g} is None else str(${g}))`;
}

export function generatePythonFromRows(rows: FormulaBuilderRow[]): string {
  const body: string[] = [
    "def transform(payload):",
    "    def _g(p, path):",
    "        if not path or not isinstance(p, dict):",
    "            return None",
    "        cur = p",
    '        for part in str(path).split("."):',
    "            if not part:",
    "                continue",
    "            if not isinstance(cur, dict) or part not in cur:",
    "                return None",
    "            cur = cur[part]",
    "        return cur",
    "    out = {}",
  ];

  for (const r of rows) {
    const ok = (r.outputKey || "").trim();
    if (!ok) continue;
    const key = JSON.stringify(ok);

    switch (r.op) {
      case "literal": {
        const lit = r.literal.trim();
        let val: string;
        if (lit === "true") val = "True";
        else if (lit === "false") val = "False";
        else if (lit === "null" || lit === "") val = "None";
        else if (/^-?\d+(\.\d+)?$/.test(lit)) val = lit;
        else val = JSON.stringify(lit);
        body.push(`    out[${key}] = ${val}`);
        break;
      }
      case "copy": {
        const g = pathCall(r.leftPath);
        body.push(`    _v = ${g}`);
        body.push(
          `    out[${key}] = _v if isinstance(_v, (str, int, float, bool)) or _v is None else (str(_v) if _v is not None else None)`,
        );
        break;
      }
      case "add":
      case "sub":
      case "mul":
      case "div": {
        const a = floatExpr(r.leftPath);
        let b: string;
        if (r.rightKind === "path" && r.rightPath.trim()) {
          b = floatExpr(r.rightPath);
        } else {
          const n = parseFloat(r.literal.trim());
          b = Number.isFinite(n) ? String(n) : "0.0";
        }
        if (r.op === "div") {
          body.push(`    _b = ${b}`);
          body.push(`    out[${key}] = (${a} / _b) if _b else 0.0`);
        } else {
          const sym = r.op === "add" ? "+" : r.op === "sub" ? "-" : "*";
          body.push(`    out[${key}] = (${a} ${sym} (${b}))`);
        }
        break;
      }
      case "concat": {
        const a = strExpr(r.leftPath);
        const b = r.rightKind === "path" && r.rightPath.trim() ? strExpr(r.rightPath) : JSON.stringify(r.literal);
        body.push(`    out[${key}] = ${a} + ${b}`);
        break;
      }
      case "upper":
        body.push(`    out[${key}] = ${strExpr(r.leftPath)}.upper()`);
        break;
      case "lower":
        body.push(`    out[${key}] = ${strExpr(r.leftPath)}.lower()`);
        break;
      case "strip":
        body.push(`    out[${key}] = ${strExpr(r.leftPath)}.strip()`);
        break;
      default:
        break;
    }
  }

  body.push("    return out");
  return body.join("\n");
}

export function validatePythonFormulaShape(code: string): { ok: boolean; error?: string } {
  const t = code.trim();
  if (!t) return { ok: false, error: "Formula code is empty." };
  if (!/def\s+transform\s*\(\s*payload\s*\)/.test(t)) {
    return { ok: false, error: "Must define: def transform(payload):" };
  }
  return { ok: true };
}
