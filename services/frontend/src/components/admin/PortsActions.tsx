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
    <div className="dm-controls-form__row" style={{ marginTop: "0.35rem", flexWrap: "wrap" }}>
      <button type="button" className="dm-btn dm-btn--primary" disabled={saving} onClick={onSave}>
        {saving ? "Saving…" : "Save configuration"}
      </button>
      <button type="button" className="dm-btn dm-btn--outline" disabled={testing} onClick={onTest}>
        {testing ? "Testing…" : "Test ports"}
      </button>
      <button type="button" className="dm-btn dm-btn--outline" disabled={restarting} onClick={onRestart}>
        {restarting ? "Requesting…" : "Restart services"}
      </button>
    </div>
  );
}
