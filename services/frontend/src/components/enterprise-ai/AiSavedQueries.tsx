import type { FormEvent } from "react";
import type { AISavedQuery } from "@/types/ai";

export function AiSavedQueries({
  items,
  saveName,
  onSaveName,
  onSave,
  onRun,
  onDelete,
  saving,
}: {
  items: AISavedQuery[];
  saveName: string;
  onSaveName: (v: string) => void;
  onSave: () => void;
  onRun: (q: AISavedQuery) => void;
  onDelete: (id: string) => void;
  saving: boolean;
}) {
  function submitSave(e: FormEvent) {
    e.preventDefault();
    onSave();
  }

  return (
    <div style={{ fontSize: "0.85rem" }}>
      <form onSubmit={submitSave} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <input
          value={saveName}
          onChange={(e) => onSaveName(e.target.value)}
          placeholder="Name for saved query"
          style={{ flex: "1 1 160px", padding: "0.35rem" }}
        />
        <button type="submit" disabled={saving || !saveName.trim()}>
          Save current question
        </button>
      </form>
      {!items.length ? (
        <p style={{ color: "var(--color-text-muted)" }}>No saved queries.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((s) => (
            <li
              key={s.id}
              style={{
                padding: "0.4rem 0",
                borderBottom: "1px solid var(--color-border-subtle, #333)",
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>{s.name}</strong>
                <div style={{ color: "var(--color-text-muted)" }}>{s.question}</div>
              </div>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <button type="button" onClick={() => onRun(s)}>
                  Run
                </button>
                <button type="button" onClick={() => onDelete(s.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
