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

export function AiAnswerCard({ res }: { res: AIChatResponse | null }) {
  if (!res) {
    return <p style={{ color: "var(--color-text-muted)" }}>Ask a question to see a grounded answer.</p>;
  }
  const mode = res.mode ?? (res.llm_used ? "structured_plus_llm" : "structured_only");
  const ev = res.evidence;
  const clamped = Boolean(ev.rows_clamped || ev.span_clamped);
  const rangeLine = formatUtcRange(ev);
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center" }}>
        <span
          style={{
            fontSize: "0.75rem",
            padding: "0.2rem 0.5rem",
            borderRadius: "4px",
            background: mode === "structured_plus_llm" ? "rgba(100, 181, 246, 0.15)" : "rgba(255,255,255,0.06)",
          }}
        >
          {mode === "structured_plus_llm" ? "Structured + LLM" : "Structured only"}
        </span>
        {res.degraded ? (
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              background: "rgba(249, 168, 37, 0.2)",
            }}
          >
            Degraded
          </span>
        ) : null}
        {clamped ? (
          <span
            title={ev.warnings?.join(" ") || "Results were limited by row or time caps."}
            style={{
              fontSize: "0.75rem",
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              background: "rgba(255, 152, 0, 0.18)",
              cursor: "help",
            }}
          >
            Limited sample
          </span>
        ) : null}
      </div>
      {(ev.time_range || rangeLine) && (
        <p style={{ margin: "0 0 0.6rem", fontSize: "0.82rem", color: "var(--color-text-muted)" }}>
          <strong style={{ color: "var(--color-text)" }}>Time window:</strong> {ev.time_range ?? "—"}
          {rangeLine ? (
            <span style={{ marginLeft: "0.35rem", opacity: 0.9 }}>
              ({rangeLine})
            </span>
          ) : null}
        </p>
      )}
      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0 }}>{res.answer}</p>
    </div>
  );
}
