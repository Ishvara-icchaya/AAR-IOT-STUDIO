import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { HealthRuleV2, StudioDraftForm } from "@/types/scrubberStudioForm";

const HEALTH_STATUS_OPTIONS = ["green", "yellow", "red"] as const;
const inp: CSSProperties = {
  padding: "0.45rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
};
const miniLbl: CSSProperties = { display: "grid", gap: "0.2rem", fontSize: "0.78rem", color: "var(--color-text-muted)" };
const rowChk: CSSProperties = { display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" };
const pairRow: CSSProperties = { display: "flex", gap: "0.35rem", alignItems: "center", marginBottom: "0.35rem" };
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
};

function defaultRule(): HealthRuleV2 {
  return { name: "", condition: "", status: "yellow", priority: "50", code: "", message: "" };
}

export function HealthStepEditor(props: {
  form: StudioDraftForm;
  setForm: Dispatch<SetStateAction<StudioDraftForm>>;
  datalistId: string;
}) {
  const { form, setForm, datalistId } = props;

  function setRule(i: number, patch: Partial<HealthRuleV2>) {
    setForm((f) => {
      const next = [...f.healthRulesV2];
      next[i] = { ...next[i], ...patch };
      return { ...f, healthRulesV2: next };
    });
  }

  function setMapPair(i: number, patch: { incoming?: string; outStatus?: string }) {
    setForm((f) => {
      const next = [...f.healthMapPairs];
      next[i] = { ...next[i], ...patch };
      return { ...f, healthMapPairs: next };
    });
  }

  return (
    <>
      <p style={{ fontSize: "0.78rem", color: "var(--color-text-muted)", marginTop: 0 }}>
        Map an upstream field to green/yellow/red, or define rule expressions with precedence (red beats yellow beats green; tie-break
        by higher priority).
      </p>
      <div style={pairRow}>
        <label style={rowChk}>
          <input
            type="radio"
            checked={form.healthEngineMode === "map"}
            onChange={() => setForm((f) => ({ ...f, healthEngineMode: "map" }))}
          />{" "}
          Map incoming health field
        </label>
        <label style={rowChk}>
          <input
            type="radio"
            checked={form.healthEngineMode === "rules"}
            onChange={() => setForm((f) => ({ ...f, healthEngineMode: "rules" }))}
          />{" "}
          Compute from rules
        </label>
      </div>

      {form.healthEngineMode === "map" ? (
        <>
          <label style={miniLbl}>
            Source field
            <input
              style={inp}
              list={datalistId}
              value={form.healthMapSourceField}
              onChange={(e) => setForm((f) => ({ ...f, healthMapSourceField: e.target.value }))}
              placeholder="e.g. status"
            />
          </label>
          <div style={{ fontWeight: 600, fontSize: "0.82rem", margin: "0.5rem 0 0.25rem" }}>Value mapping</div>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--color-surface-elevated)" }}>
                  <th style={th}>Incoming value</th>
                  <th style={th}>Output status</th>
                </tr>
              </thead>
              <tbody>
                {form.healthMapPairs.map((row, i) => (
                  <tr key={i}>
                    <td style={td}>
                      <input
                        style={{ ...inp, width: "100%" }}
                        value={row.incoming}
                        onChange={(e) => setMapPair(i, { incoming: e.target.value })}
                        placeholder="e.g. OK"
                      />
                    </td>
                    <td style={td}>
                      <select
                        style={inp}
                        value={HEALTH_STATUS_OPTIONS.includes(row.outStatus as (typeof HEALTH_STATUS_OPTIONS)[number]) ? row.outStatus : "green"}
                        onChange={(e) => setMapPair(i, { outStatus: e.target.value })}
                      >
                        {HEALTH_STATUS_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="scrubber-btn scrubber-btn--ghost"
            style={{ marginTop: "0.35rem" }}
            onClick={() => setForm((f) => ({ ...f, healthMapPairs: [...f.healthMapPairs, { incoming: "", outStatus: "green" }] }))}
          >
            Add row
          </button>
          <label style={{ ...miniLbl, marginTop: "0.5rem" }}>
            Message from field (optional)
            <input
              style={inp}
              list={datalistId}
              value={form.healthMapMessageFrom}
              onChange={(e) => setForm((f) => ({ ...f, healthMapMessageFrom: e.target.value }))}
              placeholder="e.g. status_message"
            />
          </label>
        </>
      ) : (
        <>
          <label style={miniLbl}>
            Default status (no rule matched)
            <select
              style={inp}
              value={form.healthRulesDefault}
              onChange={(e) => setForm((f) => ({ ...f, healthRulesDefault: e.target.value }))}
            >
              {HEALTH_STATUS_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div style={{ fontWeight: 600, fontSize: "0.82rem", margin: "0.65rem 0 0.25rem" }}>Rules</div>
          <p style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", margin: "0 0 0.35rem" }}>
            Conditions: comparisons like <code>cpu &gt; 70</code>, <code>memory &gt; 50 and cpu &gt; 70</code>, string equals{" "}
            <code>status == &quot;WARN&quot;</code>.
          </p>
          {form.healthRulesV2.map((r, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "0.5rem",
                marginBottom: "0.5rem",
              }}
            >
              <label style={miniLbl}>
                Name
                <input style={inp} value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} />
              </label>
              <label style={{ ...miniLbl, marginTop: "0.35rem" }}>
                Condition
                <input
                  style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}
                  value={r.condition}
                  onChange={(e) => setRule(i, { condition: e.target.value })}
                  placeholder='e.g. disk > 90'
                />
              </label>
              <div style={{ ...pairRow, marginTop: "0.35rem", flexWrap: "wrap" }}>
                <label style={miniLbl}>
                  Priority
                  <input style={{ ...inp, width: "5rem" }} value={r.priority} onChange={(e) => setRule(i, { priority: e.target.value })} />
                </label>
                <label style={miniLbl}>
                  Status
                  <select style={inp} value={r.status} onChange={(e) => setRule(i, { status: e.target.value })}>
                    {HEALTH_STATUS_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={{ ...miniLbl, marginTop: "0.35rem" }}>
                Code
                <input style={inp} value={r.code} onChange={(e) => setRule(i, { code: e.target.value })} />
              </label>
              <label style={{ ...miniLbl, marginTop: "0.35rem" }}>
                Message
                <input style={inp} value={r.message} onChange={(e) => setRule(i, { message: e.target.value })} />
              </label>
              <button
                type="button"
                className="scrubber-btn scrubber-btn--ghost"
                style={{ marginTop: "0.35rem" }}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    healthRulesV2: f.healthRulesV2.filter((_, j) => j !== i) || [defaultRule()],
                  }))
                }
              >
                Remove rule
              </button>
            </div>
          ))}
          <button type="button" className="scrubber-btn scrubber-btn--ghost" onClick={() => setForm((f) => ({ ...f, healthRulesV2: [...f.healthRulesV2, defaultRule()] }))}>
            Add rule
          </button>
        </>
      )}

      <details style={{ marginTop: "0.75rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Health output keys</summary>
        <label style={rowChk}>
          <input
            type="checkbox"
            checked={form.healthDisplayEnabled}
            onChange={(e) => setForm((f) => ({ ...f, healthDisplayEnabled: e.target.checked }))}
          />{" "}
          Copy normalized health onto payload
        </label>
        <div style={pairRow}>
          <label style={miniLbl}>
            Status key
            <input style={inp} value={form.healthStatusKey} onChange={(e) => setForm((f) => ({ ...f, healthStatusKey: e.target.value }))} />
          </label>
          <label style={miniLbl}>
            Code key
            <input style={inp} value={form.healthCodeKey} onChange={(e) => setForm((f) => ({ ...f, healthCodeKey: e.target.value }))} />
          </label>
          <label style={miniLbl}>
            Message key
            <input style={inp} value={form.healthMessageKey} onChange={(e) => setForm((f) => ({ ...f, healthMessageKey: e.target.value }))} />
          </label>
        </div>
      </details>
    </>
  );
}
