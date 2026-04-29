/**
 * Lightweight guardrail: catch reintroduction of native dialogs, legacy pill/pager
 * button strings, scrubber2-btn outside the editor, and (optional strict) raw hex in pages TSX.
 *
 * Usage: node scripts/check-design-drift.mjs
 * Strict hex in pages: DESIGN_DRIFT_STRICT=1 node scripts/check-design-drift.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.join(__dirname, "..", "src");
const PAGES_ROOT = path.join(SRC_ROOT, "pages");

const NATIVE_DIALOG = /\bwindow\.(confirm|alert|prompt)\s*\(/;
const LEGACY_CLASS = /\bdm-(pill|table-pager__btn)\b/;
const LEGACY_PAGER_BTN = /\bop-table-pager__btn\b/;
const SCRUBBER_BTN = /\bscrubber2-btn\b/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const SHARED_DASHBOARD_SELECTOR =
  /\.page-card\.dash-live-page[^{]*,\s*\.dash-preview-panel__scroll--fit[^{]*\{/gm;

/** @type {{ file: string; line: number; message: string }[]} */
const findings = [];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === "dist") continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
}

function rel(p) {
  return path.relative(path.join(__dirname, ".."), p);
}

function checkFile(absPath) {
  const ext = path.extname(absPath);
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"].includes(ext)) return;
  const text = fs.readFileSync(absPath, "utf8");
  const lines = text.split(/\r?\n/);
  const inScrubberEditor = absPath.includes(`${path.sep}pages${path.sep}scrubber2${path.sep}`);

  if (ext === ".css") {
    const isDashboardStyles = absPath.includes(`${path.sep}src${path.sep}index.css`);
    if (isDashboardStyles) {
      let match;
      // eslint-disable-next-line no-cond-assign
      while ((match = SHARED_DASHBOARD_SELECTOR.exec(text))) {
        const before = text.slice(0, match.index);
        const line = before.split(/\r?\n/).length;
        findings.push({
          file: rel(absPath),
          line,
          message:
            "Do not couple live+preview selectors in one rule. Split .page-card.dash-live-page and .dash-preview-panel__scroll--fit rules.",
        });
      }
    }
    return;
  }

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (NATIVE_DIALOG.test(line)) {
      findings.push({ file: rel(absPath), line: lineNo, message: "Native browser dialog — use useConfirmAction / in-app UI." });
    }
    if (LEGACY_CLASS.test(line)) {
      findings.push({
        file: rel(absPath),
        line: lineNo,
        message: "Forbidden legacy class string (dm-pill / dm-table-pager__btn).",
      });
    }
    if (LEGACY_PAGER_BTN.test(line)) {
      findings.push({
        file: rel(absPath),
        line: lineNo,
        message: "Forbidden legacy class op-table-pager__btn — use AarButton + op-table-pager__action (PlainOperationalTable pattern).",
      });
    }
    if (SCRUBBER_BTN.test(line) && !inScrubberEditor) {
      findings.push({
        file: rel(absPath),
        line: lineNo,
        message: "scrubber2-btn is reserved for Scrubber 2 editor pages under src/pages/scrubber2/.",
      });
    }

    const strictHex = process.env.DESIGN_DRIFT_STRICT === "1";
    const underPagesTsx = absPath.startsWith(PAGES_ROOT) && (ext === ".tsx" || ext === ".ts");
    if (strictHex && underPagesTsx && HEX.test(line)) {
      findings.push({
        file: rel(absPath),
        line: lineNo,
        message: "Hardcoded hex in pages — prefer CSS tokens (var(--aar-*)).",
      });
    }
  });
}

const files = [];
walk(SRC_ROOT, files);
for (const f of files) checkFile(f);

for (const f of findings) {
  console.error(`error\t${f.file}:${f.line}\t${f.message}`);
}

if (findings.length) {
  console.error(`\ncheck-design-drift: ${findings.length} error(s).`);
  process.exit(1);
}

console.log("check-design-drift: OK.");
