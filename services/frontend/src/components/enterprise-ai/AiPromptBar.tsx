import type { FormEvent } from "react";
import { Sparkles } from "lucide-react";

const MAX_LEN = 1000;

export function AiPromptBar({
  useLlm,
  onUseLlmChange,
  message,
  onMessageChange,
  onSubmit,
  loading,
}: {
  useLlm: boolean;
  onUseLlmChange: (v: boolean) => void;
  message: string;
  onMessageChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form className="ea-prompt-form" onSubmit={onFormSubmit}>
      <div className="ea-prompt-controls">
        <div className="ea-prompt-options" role="group" aria-label="Assistant options">
          <label className="ea-check ea-check--option" title="Use local LLM after structured retrieval">
            <input type="checkbox" checked={useLlm} onChange={(e) => onUseLlmChange(e.target.checked)} />
            <span>Local</span>
          </label>
        </div>
      </div>

      <div className="dm-filter-field dm-filter-field--grow">
        <label htmlFor="ea-question-input">Your question</label>
        <textarea
          id="ea-question-input"
          value={message}
          maxLength={MAX_LEN}
          onChange={(e) => onMessageChange(e.target.value)}
          rows={5}
          placeholder="e.g. Fleet trucks — license plates? (uses latest ingested data objects + KPI keys; platform Devices are separate)"
        />
        <div className="ea-question-meta">
          <span>
            {message.length}/{MAX_LEN}
          </span>
        </div>
        <button className="dm-btn dm-btn--primary" type="submit" disabled={loading || !message.trim()}>
          {loading ? (
            "Asking…"
          ) : (
            <>
              <Sparkles size={18} strokeWidth={2} aria-hidden />
              Ask
            </>
          )}
        </button>
      </div>
    </form>
  );
}
