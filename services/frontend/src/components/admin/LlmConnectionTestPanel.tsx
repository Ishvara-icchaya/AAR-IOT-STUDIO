type Props = {
  disabled?: boolean;
  onTest: () => void;
  testing: boolean;
  lastMessage: string | null;
};

export function LlmConnectionTestPanel({ disabled, onTest, testing, lastMessage }: Props) {
  return (
    <section className="admin-panel">
      <h2 className="admin-panel__title">Connection</h2>
      <button type="button" className="admin-btn admin-btn--secondary" disabled={disabled || testing} onClick={onTest}>
        {testing ? "Testing…" : "Test connection"}
      </button>
      {lastMessage ? <p className="admin-panel__hint">{lastMessage}</p> : null}
    </section>
  );
}
