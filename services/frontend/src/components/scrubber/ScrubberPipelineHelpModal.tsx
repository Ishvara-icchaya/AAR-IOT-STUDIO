import { useEffect, useState, type ReactNode } from "react";
import type { PipelineStepId } from "@/types/scrubberPipeline";

export type ScrubberHelpTabId = "overview" | PipelineStepId;

const TABS: { id: ScrubberHelpTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "drop", label: "Drop" },
  { id: "addAttributes", label: "Add attributes" },
  { id: "scalars", label: "Derived fields" },
  { id: "functionBased", label: "Function based" },
  { id: "gps", label: "Location / GPS" },
  { id: "health", label: "Health" },
  { id: "kpi", label: "KPI" },
];

const JSON_NESTED_SAMPLE = `{
  "device_id": "pump-12",
  "readings": {
    "temp_c": 72.4,
    "pressure_psi": 14.1
  },
  "site": {
    "code": "PLANT-A",
    "line": 3
  }
}`;

const JSON_FLAT_SAMPLE = `{
  "device_id": "pump-12",
  "readings_temp_c": 72.4,
  "readings_pressure_psi": 14.1,
  "site_code": "PLANT-A",
  "site_line": 3
}`;

const JSON_FLAT_NON_NESTED = `{
  "device_id": "pump-12",
  "temp_c": 72.4,
  "pressure_psi": 14.1,
  "site_code": "PLANT-A"
}`;

function JsonBlock({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ marginTop: "0.65rem" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>
        {title}
      </div>
      <pre className="scrubber-pre scrubber-help-pre">{body}</pre>
    </div>
  );
}

function TabPanelOverview() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5, color: "var(--color-text)" }}>
      <p style={{ marginTop: 0 }}>
        The scrubber runs <strong>in order</strong> on the parsed raw JSON (after optional <code>selectPath</code> in
        mapping JSON / debug editor):
      </p>
      <ol style={{ paddingLeft: "1.25rem", margin: "0.5rem 0" }}>
        <li>
          <strong>Drop</strong> — remove dotted paths from the working object (tabular or freeform).
        </li>
        <li>
          <strong>Flatten</strong> (checkbox next to Help) — repeatedly merges nested objects into{" "}
          <code>parent_delimiter_child</code> keys until no nested objects remain (arrays unchanged; delimiter defaults
          to <code>_</code> in mapping JSON).
        </li>
        <li>
          <strong>Add attributes</strong> — merge literal keys and copy values from paths.
        </li>
        <li>
          <strong>Derived fields</strong> — add scalars from paths or literals.
        </li>
        <li>
          <strong>Function based</strong> — Python <code>transform(payload)</code> (server compile only).
        </li>
        <li>
          <strong>Location / GPS</strong> — map transformed fields into normalized <code>gps.lat</code>/<code>gps.lon</code> plus optional
          fields; timestamp normalized to UTC ISO-8601.
        </li>
        <li>
          <strong>Health</strong> — map an upstream field to green/yellow/red, or evaluate rule expressions with precedence.
        </li>
        <li>
          <strong>KPI</strong> — <code>displayFields</code> for dashboard detail and <code>metrics</code> for time-series (stored in{" "}
          <code>kpi_json</code>).
        </li>
      </ol>
      <p style={{ color: "var(--color-text-muted)", marginBottom: 0 }}>
        <strong>Live</strong> preview in the UI matches this order except Python is simulated until you click{" "}
        <strong>Compile preview</strong>.
      </p>
      <JsonBlock title="Example — nested raw payload (before flatten)" body={JSON_NESTED_SAMPLE} />
      <JsonBlock title="Example — after full flatten with delimiter _" body={JSON_FLAT_SAMPLE} />
      <JsonBlock title="Example — already flat (no nested objects under top level)" body={JSON_FLAT_NON_NESTED} />
    </div>
  );
}

function TabPanelDrop() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
      <p style={{ marginTop: 0 }}>
        Use <strong>Tabular</strong> to toggle Keep/Drop on paths discovered from the loaded JSON, or{" "}
        <strong>Advanced freeform</strong> for one path per line. Dotted paths match nested keys (e.g.{" "}
        <code>readings.temp_c</code>).
      </p>
      <JsonBlock title="Nested payload (paths use dots)" body={JSON_NESTED_SAMPLE} />
      <p>
        Example drop path <code>readings.temp_c</code> removes only that leaf; <code>readings</code> can remain with{" "}
        <code>pressure_psi</code>.
      </p>
      <JsonBlock title="Flat payload (paths match flattened keys)" body={JSON_FLAT_SAMPLE} />
      <p>
        Example drop path <code>readings_temp_c</code> removes that top-level key entirely.
      </p>
    </div>
  );
}

function TabPanelAddAttributes() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
      <p style={{ marginTop: 0 }}>
        <strong>Literals</strong> set fixed keys (JSON values allowed). <strong>From payload</strong> copies from dotted
        paths on the <em>current</em> working object (after drop/flatten).
      </p>
      <JsonBlock
        title="Working object (flat)"
        body={`${JSON_FLAT_SAMPLE}\n\nLiteral plant → "East"\nFrom payload key temp ← path readings_temp_c → copies 72.4`}
      />
    </div>
  );
}

function TabPanelScalars() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
      <p style={{ marginTop: 0 }}>
        Each row adds a <strong>top-level scalar</strong> only. <strong>fromPath</strong> uses dotted paths on the
        current payload; <strong>literal</strong> accepts JSON (quoted strings, numbers).
      </p>
      <JsonBlock
        title="After flatten, path mode"
        body={`Field max_temp ← fromPath readings_temp_c  → 72.4\nField label ← literal "PUMP-12"`}
      />
    </div>
  );
}

function TabPanelFunctionBased() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
      <p style={{ marginTop: 0 }}>
        Define <code>def transform(payload):</code> returning a dict of <strong>scalar</strong> fields only.{" "}
        <code>payload</code> is the dict <strong>after</strong> drop, flatten, attributes, and derived fields — use{" "}
        <code>{'payload.get("readings_temp_c")'}</code> on flat data, or{" "}
        <code>{'payload.get("readings", {}).get("temp_c")'}</code>{" "}
        if still nested.
      </p>
      <JsonBlock
        title="Example transform (flat keys)"
        body={`def transform(payload):\n    return {\n        "temp_rounded": round(float(payload.get("readings_temp_c", 0)), 1),\n    }`}
      />
      <p style={{ color: "var(--color-text-muted)" }}>Imports are blocked; string/date/math helpers are provided (see template in the editor).</p>
    </div>
  );
}

function TabPanelHealth() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
      <p style={{ marginTop: 0 }}>
        <strong>Map</strong> mode reads one field (e.g. <code>status</code>), maps string values to green/yellow/red, and optionally pulls a
        message from another path. <strong>Rules</strong> mode evaluates safe expressions like <code>cpu &gt; 70 and memory &gt; 50</code>; the
        highest severity wins, then priority.
      </p>
      <JsonBlock title="Flat payload excerpt" body={`{ "readings_temp_c": 72.4, "device_id": "pump-12" }`} />
      <p style={{ color: "var(--color-text-muted)" }}>
        <strong>Health display</strong> copies normalized <code>health_status</code> / <code>health_code</code> / <code>health_message</code> onto the payload (keys are configurable).
      </p>
    </div>
  );
}

function TabPanelGps() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
      <p style={{ marginTop: 0 }}>
        GPS mapping runs after drop/flatten/add-attributes/derived/function steps and writes nested normalized fields:
        <code> gps.lat</code>, <code>gps.lon</code>, optional <code>gps.alt</code>, <code>gps.heading</code>, <code>gps.speed</code>,
        <code>gps.timestamp</code>.
      </p>
      <p>
        Latitude must be <code>-90..90</code> and longitude <code>-180..180</code>. Only valid lat/lon pairs are map-eligible
        (<code>gps.map_eligible=true</code>).
      </p>
      <JsonBlock
        title="Normalized GPS shape"
        body={`{
  "gps": {
    "lat": 12.9716,
    "lon": 77.5946,
    "timestamp": "2026-04-09T10:23:00.000Z",
    "map_eligible": true
  }
}`}
      />
    </div>
  );
}

function TabPanelKpi() {
  return (
    <div style={{ fontSize: "0.82rem", lineHeight: 1.5 }}>
      <p style={{ marginTop: 0 }}>
        KPI output is a structured object: <strong>displayFields</strong> (paths → values for dashboard click/detail) and{" "}
        <strong>metrics</strong> (numeric paths with units and 1h/24h window flags for runtime history — not written in browser preview). In
        the studio, each metric&apos;s field is picked from detected <strong>numeric</strong> leaf attributes on the current sample, not typed
        free-form.
      </p>
      <JsonBlock
        title="Shape (conceptual)"
        body={`displayFields: ["readings_temp_c", "device_id"]\nmetrics: { "readings_temp_c": { type: "numeric", windows: ["1h","24h"], unit: "C" } }`}
      />
    </div>
  );
}

function renderPanel(id: ScrubberHelpTabId): ReactNode {
  switch (id) {
    case "overview":
      return <TabPanelOverview />;
    case "drop":
      return <TabPanelDrop />;
    case "addAttributes":
      return <TabPanelAddAttributes />;
    case "scalars":
      return <TabPanelScalars />;
    case "functionBased":
      return <TabPanelFunctionBased />;
    case "health":
      return <TabPanelHealth />;
    case "gps":
      return <TabPanelGps />;
    case "kpi":
      return <TabPanelKpi />;
    default:
      return null;
  }
}

export function ScrubberPipelineHelpModal({
  open,
  onClose,
  initialStepId,
}: {
  open: boolean;
  onClose: () => void;
  initialStepId: PipelineStepId;
}) {
  const [tab, setTab] = useState<ScrubberHelpTabId>("overview");

  useEffect(() => {
    if (open) setTab(initialStepId);
  }, [open, initialStepId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="scrubber-debug-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="scrubber-help-modal"
        role="dialog"
        aria-modal
        aria-labelledby="scrubber-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="scrubber-debug-modal__head">
          <h2 id="scrubber-help-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
            Pipeline help
          </h2>
          <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="scrubber-help-tabs" role="tablist" aria-label="Help sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`scrubber-help-tab${tab === t.id ? " scrubber-help-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="scrubber-help-panel" role="tabpanel">
          {renderPanel(tab)}
        </div>
      </div>
    </div>
  );
}
