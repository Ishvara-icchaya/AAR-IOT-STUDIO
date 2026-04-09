import { useShellMessage } from "./ShellMessageContext";

export function PageMessageBar() {
  const { messages, dismissMessage } = useShellMessage();
  if (messages.length === 0) return null;
  return (
    <div className="shell-message-bar" role="region" aria-label="Page messages">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`shell-message shell-message--${m.tone}`}
          role="status"
        >
          <span className="shell-message__text">{m.text}</span>
          <button
            type="button"
            className="shell-message__dismiss"
            aria-label="Dismiss"
            onClick={() => dismissMessage(m.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
