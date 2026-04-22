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
    <div className="ea-saved-queries">
      <form className="dm-controls-form__row ea-saved-queries__save" onSubmit={submitSave}>
        <div className="dm-filter-field dm-filter-field--grow">
          <label htmlFor="ea-saved-name">Save as</label>
          <input
            id="ea-saved-name"
            type="text"
            value={saveName}
            onChange={(e) => onSaveName(e.target.value)}
            placeholder="Name for saved query"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="dm-btn dm-btn--primary" disabled={saving || !saveName.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      {!items.length ? (
        <p className="dm-inline-summary">No saved queries.</p>
      ) : (
        <ul className="ea-query-list">
          {items.map((s) => (
            <li key={s.id} className="ea-query-list__row ea-query-list__row--saved">
              <div className="ea-query-list__saved-body">
                <strong className="ea-query-list__saved-name">{s.name}</strong>
                <div className="ea-query-list__saved-q">{s.question}</div>
              </div>
              <div className="ea-query-list__actions">
                <button type="button" className="dm-btn dm-btn--outline" onClick={() => onRun(s)}>
                  Run
                </button>
                <button type="button" className="dm-btn dm-btn--outline" onClick={() => onDelete(s.id)}>
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
