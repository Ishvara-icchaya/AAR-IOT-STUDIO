import type { AIRecentQuery } from "@/types/ai";

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
    return <p style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>No recent queries.</p>;
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.82rem" }}>
      {items.map((q) => (
        <li
          key={q.id}
          style={{
            padding: "0.45rem 0",
            borderBottom: "1px solid var(--color-border-subtle, #333)",
            display: "flex",
            justifyContent: "space-between",
            gap: "0.5rem",
            alignItems: "flex-start",
          }}
        >
          <span style={{ flex: 1 }}>
            <span
              style={{
                fontSize: "0.68rem",
                marginRight: "0.35rem",
                padding: "0.1rem 0.35rem",
                borderRadius: "3px",
                background: "rgba(255,255,255,0.06)",
                verticalAlign: "middle",
              }}
            >
              {modeLabel(q)}
            </span>
            {q.question}
          </span>
          <button
            type="button"
            onClick={() => onReuse(q.question)}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--color-accent)",
              cursor: "pointer",
              textDecoration: "underline",
              whiteSpace: "nowrap",
            }}
          >
            Reuse
          </button>
        </li>
      ))}
    </ul>
  );
}
