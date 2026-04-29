import type { Scrubber2FieldMeta } from "@/lib/scrubber2Fields";
import { getByPath } from "@/lib/scrubber2Fields";
import { Scrubber2FieldPicker } from "./Scrubber2FieldPicker";
import { SCRUBBER2_SEMANTIC_ROLES, type Scrubber2Model } from "@/types/scrubber2Model";
import { apiFetch } from "@/api/client";
import { buildScrubberStudioMappingForPreview } from "@/lib/scrubber2ToStudioDraft";

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

type Props = {
  stepIndex: number;
  model: Scrubber2Model;
  setModel: (fn: (m: Scrubber2Model) => Scrubber2Model) => void;
  fields: Scrubber2FieldMeta[];
  samplePayload: Record<string, unknown> | null;
  rawId: string | null;
  onRequestPreview: () => void;
};

export function Scrubber2StepContent({
  stepIndex,
  model,
  setModel,
  fields,
  samplePayload,
  rawId,
  onRequestPreview,
}: Props) {
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
                        fields={fields}
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
                        fields={fields}
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
    return (
      <>
        <p className="scrubber2-muted">
          Safe Python-style block: define <code>transform(payload)</code> returning a dict of scalar fields. No imports.
        </p>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={model.derived.enabled}
            onChange={(e) => setModel((m) => ({ ...m, derived: { ...m.derived, enabled: e.target.checked } }))}
          />
          Enable derived transform
        </label>
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
                  { ...model, derived: { ...model.derived, enabled: true } },
                  { objectName: "preview", version: "0", parseAs: "auto" },
                  samplePayload ?? {},
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
    const syncFromFields = () => {
      setModel((m) => {
        const existing = new Map(m.fieldSemantics.map((s) => [s.path, s]));
        for (const f of fields) {
          if (!existing.has(f.path)) {
            existing.set(f.path, { path: f.path, type: f.type, roles: [], label: "" });
          }
        }
        return { ...m, fieldSemantics: [...existing.values()] };
      });
    };
    return (
      <>
        <div className="scrubber2-toolbar">
          <button type="button" className="scrubber2-btn scrubber2-btn--ghost" onClick={syncFromFields}>
            Sync fields from explorer
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
        </div>
        <div className="scrubber2-table-scroll">
          <table className="scrubber2-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Type</th>
                <th>Label</th>
                <th className="scrubber2-col-roles">Roles</th>
                <th>AI</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.fieldSemantics.map((row, i) => (
                <tr key={i}>
                  <td>
                    <Scrubber2FieldPicker
                      fields={fields}
                      value={row.path}
                      onChange={(p) =>
                        setModel((m) => {
                          const fs = [...m.fieldSemantics];
                          const hit = fields.find((x) => x.path === p);
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
      </>
    );
  }

  if (stepIndex === 5) {
    const cfg = model.health.config;
    return (
      <>
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
              fields={fields}
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
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <label>
            <span className="scrubber2-muted">Latitude</span>
            <div>
              <Scrubber2FieldPicker
                fields={fields}
                value={model.location.latitudePath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, latitudePath: p } }))}
              />
            </div>
          </label>
          <label>
            <span className="scrubber2-muted">Longitude</span>
            <div>
              <Scrubber2FieldPicker
                fields={fields}
                value={model.location.longitudePath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, longitudePath: p } }))}
              />
            </div>
          </label>
          <label>
            <span className="scrubber2-muted">Altitude (optional)</span>
            <div>
              <Scrubber2FieldPicker
                fields={fields}
                value={model.location.altitudePath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, altitudePath: p } }))}
              />
            </div>
          </label>
          <label>
            <span className="scrubber2-muted">Heading (optional)</span>
            <div>
              <Scrubber2FieldPicker
                fields={fields}
                value={model.location.headingPath ?? ""}
                onChange={(p) => setModel((m) => ({ ...m, location: { ...m.location, headingPath: p } }))}
              />
            </div>
          </label>
        </div>
        {samplePayload ? (
          <div className="scrubber2-muted" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
            Sample lat:{" "}
            {model.location.latitudePath ? String(getByPath(samplePayload, model.location.latitudePath) ?? "—") : "—"}
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
