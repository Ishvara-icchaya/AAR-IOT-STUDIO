import type { CSSProperties } from "react";
import type { LlmConfigUpdateDTO } from "@/types/llmConfig";

const ta: CSSProperties = {
  width: "100%",
  minHeight: "6rem",
  padding: "0.5rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "inherit",
  fontSize: "0.88rem",
};

type Props = {
  value: LlmConfigUpdateDTO;
  onChange: (p: Partial<LlmConfigUpdateDTO>) => void;
};

export function LlmPromptTemplatesPanel({ value, onChange }: Props) {
  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Prompt templates</h2>
      <p className="admin-panel__muted">Appended to the base system instruction for LLM turns (size-limited server-side).</p>
      <label className="admin-field">
        Summary prompt
        <textarea
          style={ta}
          value={value.summary_prompt ?? ""}
          onChange={(e) => onChange({ summary_prompt: e.target.value || null })}
        />
      </label>
      <label className="admin-field">
        Incident prompt
        <textarea
          style={ta}
          value={value.incident_prompt ?? ""}
          onChange={(e) => onChange({ incident_prompt: e.target.value || null })}
        />
      </label>
      <label className="admin-field">
        Trend prompt
        <textarea
          style={ta}
          value={value.trend_prompt ?? ""}
          onChange={(e) => onChange({ trend_prompt: e.target.value || null })}
        />
      </label>
    </section>
  );
}
