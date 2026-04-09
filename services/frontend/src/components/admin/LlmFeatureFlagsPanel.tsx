import type { LlmConfigUpdateDTO } from "@/types/llmConfig";

type Props = {
  value: LlmConfigUpdateDTO;
  onChange: (p: Partial<LlmConfigUpdateDTO>) => void;
  isAdmin: boolean;
};

export function LlmFeatureFlagsPanel({ value, onChange, isAdmin }: Props) {
  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Feature flags</h2>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={value.enable_llm}
          onChange={(e) => onChange({ enable_llm: e.target.checked })}
        />
        Enable LLM summaries
      </label>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={value.enable_suggestions}
          onChange={(e) => onChange({ enable_suggestions: e.target.checked })}
        />
        Enable suggested queries
      </label>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={value.enable_raw_debug}
          disabled={!isAdmin}
          onChange={(e) => onChange({ enable_raw_debug: e.target.checked })}
        />
        Enable raw debug (admin-only gate; still requires admin role at runtime)
      </label>
    </section>
  );
}
