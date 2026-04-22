import { MessageCircle } from "lucide-react";
import type { AIChatResponse } from "@/types/ai";

function formatUtcRange(ev: AIChatResponse["evidence"]) {
  const w = ev.time_window_utc;
  if (!w?.start || !w?.end) return null;
  try {
    const a = new Date(w.start).toISOString().slice(0, 16).replace("T", " ");
    const b = new Date(w.end).toISOString().slice(0, 16).replace("T", " ");
    return `${a} → ${b} UTC`;
  } catch {
    return null;
  }
}

export function AiAnswerCard({
  res,
  emptyStyle = "default",
  compact = false,
}: {
  res: AIChatResponse | null;
  /** `hero` = large centered empty state (Enterprise AI dashboard layout). */
  emptyStyle?: "default" | "hero";
  /** Tighter typography and clamped answer height (Answer tab in compact layout). */
  compact?: boolean;
}) {
  if (!res) {
    if (emptyStyle === "hero") {
      return (
        <div className="ea-empty-answer">
          <MessageCircle size={44} strokeWidth={1.25} aria-hidden />
          <p>
            <strong>Ask a question</strong> — Your grounded answer will appear here.
          </p>
        </div>
      );
    }
    return <p className="dm-inline-summary">Ask a question to see a grounded answer.</p>;
  }
  const mode = res.mode ?? (res.llm_used ? "structured_plus_llm" : "structured_only");
  const ev = res.evidence;
  const clamped = Boolean(ev.rows_clamped || ev.span_clamped);
  const rangeLine = formatUtcRange(ev);
  return (
    <div className={compact ? "ea-answer-card ea-answer-card--compact" : "ea-answer-card"}>
      <div className="ea-answer-card__meta">
        <span className={mode === "structured_plus_llm" ? "dm-pill dm-pill--neon" : "dm-pill dm-pill--muted"}>
          {mode === "structured_plus_llm" ? "Structured + LLM" : "Structured only"}
        </span>
        {res.degraded ? <span className="dm-pill dm-pill--warn">Degraded</span> : null}
        {clamped ? (
          <span
            className="dm-pill dm-pill--warn ea-answer-card__pill--help"
            title={ev.warnings?.join(" ") || "Results were limited by row or time caps."}
          >
            Limited sample
          </span>
        ) : null}
      </div>
      {(ev.time_range || rangeLine) && (
        <p className="dm-inline-summary ea-answer-card__time">
          <strong className="ea-answer-card__time-label">Time window:</strong> {ev.time_range ?? "—"}
          {rangeLine ? <span className="ea-answer-card__time-range"> ({rangeLine})</span> : null}
        </p>
      )}
      <p className={compact ? "ea-answer-card__body ea-answer-card__body--clamp" : "ea-answer-card__body"}>
        {res.answer}
      </p>
    </div>
  );
}
