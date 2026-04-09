type Props = {
  saving: boolean;
  testing: boolean;
  restarting: boolean;
  onSave: () => void;
  onTest: () => void;
  onRestart: () => void;
};

export function PortsActions({ saving, testing, restarting, onSave, onTest, onRestart }: Props) {
  return (
    <div className="admin-actions">
      <button type="button" className="admin-btn" disabled={saving} onClick={onSave}>
        {saving ? "Saving…" : "Save configuration"}
      </button>
      <button type="button" className="admin-btn admin-btn--secondary" disabled={testing} onClick={onTest}>
        {testing ? "Testing…" : "Test ports"}
      </button>
      <button type="button" className="admin-btn admin-btn--secondary" disabled={restarting} onClick={onRestart}>
        {restarting ? "Requesting…" : "Restart services"}
      </button>
    </div>
  );
}
