import type { AIRecentQuery } from "@/types/ai";
import { AarPill } from "@/components/system/AarPill";

function modeLabel(q: AIRecentQuery) {
  const m = q.response_mode ?? (q.llm_used ? "structured_plus_llm" : "structured_only");
  return m === "structured_plus_llm" ? "LLM" : "Structured";
}

export function AiRecentQueries({
  items,
  onReuse,
}: {
  items: AIRecentQuery[];
  onReuse: (q: string) => void;
}) {
  if (!items.length) {
    return <p className="dm-inline-summary">No recent queries.</p>;
  }
  return (
    <ul className="ea-query-list">
      {items.map((q) => (
        <li key={q.id} className="ea-query-list__row">
          <span className="ea-query-list__main">
            <AarPill tone="muted" className="ea-query-list__mode" title="Response mode">
              {modeLabel(q)}
            </AarPill>
            <span className="ea-query-list__question">{q.question}</span>
          </span>
          <button type="button" className="dm-clear-filters ea-query-list__reuse" onClick={() => onReuse(q.question)}>
            Reuse
          </button>
        </li>
      ))}
    </ul>
  );
}
