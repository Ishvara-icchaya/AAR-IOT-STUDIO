import type { CSSProperties } from "react";
import type { LlmConfigUpdateDTO } from "@/types/llmConfig";

const inp: CSSProperties = {
  padding: "0.4rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  width: "100%",
  maxWidth: "12rem",
};

type Props = {
  value: LlmConfigUpdateDTO;
  onChange: (p: Partial<LlmConfigUpdateDTO>) => void;
};

function num(
  v: number,
  min: number,
  max: number,
): number {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function LlmThresholdPanel({ value, onChange }: Props) {
  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Alert thresholds</h2>
      <div className="admin-grid-2">
        <label className="admin-field">
          LLM failure threshold
          <input
            type="number"
            style={inp}
            min={1}
            max={1000}
            value={value.llm_failure_threshold}
            onChange={(e) =>
              onChange({ llm_failure_threshold: num(parseInt(e.target.value, 10), 1, 1000) })
            }
          />
        </label>
        <label className="admin-field">
          LLM cooldown (sec)
          <input
            type="number"
            style={inp}
            min={1}
            max={86400}
            value={value.llm_cooldown_seconds}
            onChange={(e) =>
              onChange({ llm_cooldown_seconds: num(parseInt(e.target.value, 10), 1, 86400) })
            }
          />
        </label>
        <label className="admin-field">
          Pipeline failure threshold
          <input
            type="number"
            style={inp}
            min={1}
            max={1000}
            value={value.pipeline_failure_threshold}
            onChange={(e) =>
              onChange({ pipeline_failure_threshold: num(parseInt(e.target.value, 10), 1, 1000) })
            }
          />
        </label>
        <label className="admin-field">
          Pipeline cooldown (sec)
          <input
            type="number"
            style={inp}
            min={1}
            max={86400}
            value={value.pipeline_cooldown_seconds}
            onChange={(e) =>
              onChange({ pipeline_cooldown_seconds: num(parseInt(e.target.value, 10), 1, 86400) })
            }
          />
        </label>
      </div>
    </section>
  );
}
