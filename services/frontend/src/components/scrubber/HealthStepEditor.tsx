import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { listHealthThresholdReferences, type HealthThresholdReferenceDTO } from "@/api/scrubber";
import { getDevice } from "@/api/devices";
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
const pairRow: CSSProperties = { display: "flex", gap: "0.35rem", alignItems: "center", marginBottom: "0.35rem", flexWrap: "wrap" };
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
  pathSuggestions: string[];
  deviceId: string;
}) {
  const { form, setForm, datalistId, pathSuggestions, deviceId } = props;
  const [registryItems, setRegistryItems] = useState<HealthThresholdReferenceDTO[]>([]);
  const [registryErr, setRegistryErr] = useState<string | null>(null);

  const loadRegistry = useCallback(async () => {
    setRegistryErr(null);
    if (!deviceId.trim()) {
      setRegistryItems([]);
      return;
    }
    try {
      const dev = await getDevice(deviceId.trim());
      const siteId = dev?.site_id;
      const data = await listHealthThresholdReferences({
        site_id: siteId,
        device_id: deviceId.trim(),
      });
      setRegistryItems(data?.items ?? []);
    } catch (e) {
      setRegistryErr(e instanceof Error ? e.message : "Failed to load threshold registry");
      setRegistryItems([]);
    }
  }, [deviceId]);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

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

  function onPickRegistry(id: string) {
    if (!id) {
      setForm((f) => ({ ...f, healthThresholdsReferenceId: "", healthThresholdsDefinition: null }));
      return;
    }
    const row = registryItems.find((r) => r.id === id);
    if (row?.body_json) {
      setForm((f) => ({
        ...f,
        healthThresholdsReferenceId: id,
        healthThresholdsDefinition: row.body_json as Record<string, unknown>,
        healthThresholdsInlineJson: JSON.stringify(row.body_json, null, 2),
        healthThresholdsSource: "registry",
      }));
    }
  }

  return (
    <>
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
          Simple rules
        </label>
        <label style={rowChk}>
          <input
            type="radio"
            checked={form.healthEngineMode === "thresholds"}
            onChange={() => setForm((f) => ({ ...f, healthEngineMode: "thresholds" }))}
          />{" "}
          Thresholds
        </label>
      </div>

      {form.healthEngineMode === "map" ? (
        <>
          <label style={miniLbl}>
            Source field
            <select
              style={inp}
              value={form.healthMapSourceField}
              onChange={(e) => setForm((f) => ({ ...f, healthMapSourceField: e.target.value }))}
            >
              <option value="">— Select attribute —</option>
              {pathSuggestions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label style={miniLbl}>
            Message from field (optional)
            <select
              style={inp}
              value={form.healthMapMessageFrom}
              onChange={(e) => setForm((f) => ({ ...f, healthMapMessageFrom: e.target.value }))}
            >
              <option value="">— None —</option>
              {pathSuggestions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div style={{ fontWeight: 600, fontSize: "0.82rem", margin: "0.5rem 0 0.25rem" }}>Value mapping</div>
          <div
            className="table-scroll-sticky"
            style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "auto" }}
          >
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
                        {HEALTH_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
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
            Add mapping row
          </button>
        </>
      ) : null}

      {form.healthEngineMode === "rules" ? (
        <>
          <label style={miniLbl}>
            Default when no rule matches
            <select
              style={inp}
              value={form.healthRulesDefault}
              onChange={(e) => setForm((f) => ({ ...f, healthRulesDefault: e.target.value }))}
            >
              {HEALTH_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {form.healthRulesV2.map((r, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "0.45rem",
                marginBottom: "0.45rem",
              }}
            >
              <div style={{ ...pairRow, marginBottom: "0.25rem" }}>
                <label style={{ ...miniLbl, flex: "1 1 120px", margin: 0 }}>
                  Name
                  <input style={inp} value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} />
                </label>
                <label style={{ ...miniLbl, flex: "0 0 88px", margin: 0 }}>
                  Priority
                  <input style={inp} value={r.priority} onChange={(e) => setRule(i, { priority: e.target.value })} />
                </label>
                <label style={{ ...miniLbl, flex: "0 0 100px", margin: 0 }}>
                  Status
                  <select style={inp} value={r.status} onChange={(e) => setRule(i, { status: e.target.value })}>
                    {HEALTH_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={miniLbl}>
                Condition (e.g. cpu &gt; 70 and memory &gt; 90)
                <input
                  style={inp}
                  list={datalistId}
                  value={r.condition}
                  onChange={(e) => setRule(i, { condition: e.target.value })}
                />
              </label>
              <div style={{ ...pairRow, marginTop: "0.25rem" }}>
                <label style={{ ...miniLbl, flex: 1, margin: 0 }}>
                  Code
                  <input style={inp} value={r.code} onChange={(e) => setRule(i, { code: e.target.value })} />
                </label>
                <label style={{ ...miniLbl, flex: 1, margin: 0 }}>
                  Message
                  <input style={inp} value={r.message} onChange={(e) => setRule(i, { message: e.target.value })} />
                </label>
              </div>
              <button
                type="button"
                className="scrubber-btn scrubber-btn--ghost"
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
      ) : null}

      {form.healthEngineMode === "thresholds" ? (
        <>
          <p style={{ fontSize: "0.76rem", color: "var(--color-text-muted)", marginTop: 0 }}>
            JSON defines <code>reference_name</code>, <code>normal</code>, <code>warning</code>, and <code>critical</code>{" "}
            maps from dotted field paths to min/max bands. Evaluation order per field: critical → warning → normal.
          </p>
          <label style={rowChk}>
            <input
              type="radio"
              checked={form.healthThresholdsSource === "inline"}
              onChange={() => setForm((f) => ({ ...f, healthThresholdsSource: "inline", healthThresholdsReferenceId: "" }))}
            />{" "}
            Paste / edit JSON
          </label>
          <label style={rowChk}>
            <input
              type="radio"
              checked={form.healthThresholdsSource === "registry"}
              onChange={() => setForm((f) => ({ ...f, healthThresholdsSource: "registry" }))}
            />{" "}
            Load from registry
          </label>
          {form.healthThresholdsSource === "registry" ? (
            <label style={miniLbl}>
              Saved reference
              <select
                style={inp}
                value={form.healthThresholdsReferenceId}
                onChange={(e) => void onPickRegistry(e.target.value)}
                disabled={!deviceId.trim()}
              >
                <option value="">— Select —</option>
                {registryItems.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.reference_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {registryErr ? <p style={{ fontSize: "0.76rem", color: "var(--page-status-error-fg)" }}>{registryErr}</p> : null}
          {!deviceId.trim() ? (
            <p style={{ fontSize: "0.76rem", color: "var(--color-text-muted)" }}>Open a device context (deviceId in URL) to list registry entries.</p>
          ) : null}
          <label style={{ ...miniLbl, marginTop: "0.5rem" }}>
            Threshold JSON
            <textarea
              style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: "0.78rem", minHeight: "12rem" }}
              value={form.healthThresholdsInlineJson}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  healthThresholdsInlineJson: e.target.value,
                  healthThresholdsDefinition: null,
                  healthThresholdsSource: "inline",
                }))
              }
            />
          </label>
        </>
      ) : null}

      <div style={{ marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid var(--color-border)" }}>
        <label style={rowChk}>
          <input
            type="checkbox"
            checked={form.healthDisplayEnabled}
            onChange={(e) => setForm((f) => ({ ...f, healthDisplayEnabled: e.target.checked }))}
          />{" "}
          Copy normalized health onto payload
        </label>
        <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.35rem", fontSize: "0.78rem" }}>
          <label style={miniLbl}>
            status key
            <input style={inp} value={form.healthStatusKey} onChange={(e) => setForm((f) => ({ ...f, healthStatusKey: e.target.value }))} />
          </label>
          <label style={miniLbl}>
            code key
            <input style={inp} value={form.healthCodeKey} onChange={(e) => setForm((f) => ({ ...f, healthCodeKey: e.target.value }))} />
          </label>
          <label style={miniLbl}>
            message key
            <input style={inp} value={form.healthMessageKey} onChange={(e) => setForm((f) => ({ ...f, healthMessageKey: e.target.value }))} />
          </label>
          <label style={miniLbl}>
            health_details key
            <input style={inp} value={form.healthDetailsKey} onChange={(e) => setForm((f) => ({ ...f, healthDetailsKey: e.target.value }))} />
          </label>
        </div>
      </div>
    </>
  );
}
