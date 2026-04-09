import type { AISuggestionItem } from "@/types/ai";

export function AiSuggestedQueries({
  items,
  onPick,
}: {
  items: AISuggestionItem[];
  onPick: (prompt: string) => void;
}) {
  if (!items.length) {
    return <p style={{ color: "var(--color-text-muted)", fontSize: "0.88rem" }}>No suggestions yet.</p>;
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((s) => (
        <li key={s.id} style={{ marginBottom: "0.5rem" }}>
          <button
            type="button"
            onClick={() => onPick(s.prompt)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "0.5rem 0.65rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              cursor: "pointer",
              fontSize: "0.85rem",
              lineHeight: 1.35,
            }}
          >
            {s.prompt}
          </button>
        </li>
      ))}
    </ul>
  );
}
