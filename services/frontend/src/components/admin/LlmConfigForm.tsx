import type { CSSProperties } from "react";
import type { LlmConfigUpdateDTO } from "@/types/llmConfig";
import { LlmConfigActions } from "./LlmConfigActions";
import { LlmConnectionTestPanel } from "./LlmConnectionTestPanel";
import { LlmFeatureFlagsPanel } from "./LlmFeatureFlagsPanel";
import { LlmPromptTemplatesPanel } from "./LlmPromptTemplatesPanel";
import { LlmThresholdPanel } from "./LlmThresholdPanel";

const inp: CSSProperties = {
  padding: "0.4rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  width: "100%",
  maxWidth: "24rem",
};

type Props = {
  value: LlmConfigUpdateDTO;
  onChange: (p: Partial<LlmConfigUpdateDTO>) => void;
  isAdmin: boolean;
  saving: boolean;
  testing: boolean;
  testMessage: string | null;
  onTest: () => void;
  onSave: () => void;
  onReset: () => void;
};

export function LlmConfigForm({
  value,
  onChange,
  isAdmin,
  saving,
  testing,
  testMessage,
  onTest,
  onSave,
  onReset,
}: Props) {
  return (
    <div className="admin-form-layout">
      <section className="admin-panel">
        <h2 className="admin-panel__title">Model configuration</h2>
        <div className="admin-grid-2">
          <label className="admin-field">
            Provider
            <select
              style={inp}
              value={value.provider}
              onChange={(e) => onChange({ provider: e.target.value })}
            >
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <label className="admin-field">
            Base URL
            <input
              style={inp}
              value={value.base_url}
              onChange={(e) => onChange({ base_url: e.target.value })}
            />
          </label>
          <label className="admin-field">
            Model name
            <input
              style={inp}
              value={value.model_name}
              onChange={(e) => onChange({ model_name: e.target.value })}
            />
          </label>
          <label className="admin-field">
            Timeout (sec)
            <input
              type="number"
              style={inp}
              min={1}
              max={3600}
              value={value.timeout_seconds}
              onChange={(e) => onChange({ timeout_seconds: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
          </label>
        </div>
        <LlmConnectionTestPanel disabled={saving} onTest={onTest} testing={testing} lastMessage={testMessage} />
      </section>

      <section className="admin-panel">
        <h2 className="admin-panel__title">Limits &amp; safety</h2>
        <div className="admin-grid-2">
          <label className="admin-field">
            Max rows to LLM
            <input
              type="number"
              style={inp}
              min={5}
              max={5000}
              value={value.max_rows}
              onChange={(e) => onChange({ max_rows: Math.min(5000, Math.max(5, parseInt(e.target.value, 10) || 5)) })}
            />
          </label>
          <label className="admin-field">
            Max prompt size (chars)
            <input
              type="number"
              style={inp}
              min={500}
              max={100000}
              value={value.max_prompt_chars}
              onChange={(e) =>
                onChange({
                  max_prompt_chars: Math.min(100_000, Math.max(500, parseInt(e.target.value, 10) || 500)),
                })
              }
            />
          </label>
          <label className="admin-field">
            Query timeout (sec)
            <input
              type="number"
              style={inp}
              min={1}
              max={3600}
              value={value.query_timeout_seconds}
              onChange={(e) =>
                onChange({ query_timeout_seconds: Math.max(1, parseInt(e.target.value, 10) || 1) })
              }
            />
          </label>
          <label className="admin-field">
            Rate limit (req/min)
            <input
              type="number"
              style={inp}
              min={1}
              max={10000}
              value={value.rate_limit_per_min}
              onChange={(e) =>
                onChange({ rate_limit_per_min: Math.min(10_000, Math.max(1, parseInt(e.target.value, 10) || 1)) })
              }
            />
          </label>
        </div>
      </section>

      <LlmFeatureFlagsPanel value={value} onChange={onChange} isAdmin={isAdmin} />
      <LlmThresholdPanel value={value} onChange={onChange} />
      <LlmPromptTemplatesPanel value={value} onChange={onChange} />
      <LlmConfigActions saving={saving} onSave={onSave} onReset={onReset} />
    </div>
  );
}
