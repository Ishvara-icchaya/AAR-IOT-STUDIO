type Props = {
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
};

export function LlmConfigActions({ saving, onSave, onReset }: Props) {
  return (
    <div className="admin-actions">
      <button type="button" className="admin-btn" disabled={saving} onClick={onSave}>
        {saving ? "Saving…" : "Save configuration"}
      </button>
      <button type="button" className="admin-btn admin-btn--danger" disabled={saving} onClick={onReset}>
        Reset to defaults
      </button>
    </div>
  );
}
